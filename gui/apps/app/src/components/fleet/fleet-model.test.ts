import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@cloudroom/domain";
import type {
  FleetSupplementResponse,
  FleetThreadFields,
  SidebarBootstrapResponse,
} from "@cloudroom/server-contract";
import {
  buildFleetModel,
  createRedactor,
  EMPTY_FLEET_FILTERS,
  stateWord,
  type FleetFilters,
} from "./fleet-model";

const NOW = 1_800_000_000_000;

function thread(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    executionTarget: "cloud",
    projectId: "proj_a",
    environmentId: null,
    providerId: "claude-code",
    title: `Thread ${id}`,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: NOW,
    latestAttentionAt: NOW - 1000,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1000,
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    queuedWork: "none",
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentIsWorktree: null,
    environmentWorkspaceDisplayKind: "other",
    ...overrides,
  };
}

function fields(overrides: Partial<FleetThreadFields> = {}): FleetThreadFields {
  return {
    configuredModel: "claude-opus-5-5",
    configuredReasoning: "high",
    inputKind: null,
    inputSummary: null,
    lastErrorSummary: null,
    latestActivityLabel: null,
    fallbackModel: null,
    cloudSandbox: {
      state: "awake",
      lastSuccessfulCheckAt: NOW - 40_000,
      lastCheckError: null,
    },
    workflowParentThreadId: null,
    ...overrides,
  };
}

function bootstrap(threads: ThreadListEntry[]): SidebarBootstrapResponse {
  const project = (id: string, name: string, list: ThreadListEntry[]) => ({
    id,
    kind: "standard" as const,
    name,
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
    sources: [],
    threads: list,
    defaultExecutionOptions: null,
  });
  return {
    sections: [],
    projects: [project("proj_a", "alpha", threads)],
    personalProject: project("proj_personal", "Personal", []),
  };
}

function supplement(
  partial: Partial<FleetSupplementResponse>,
): FleetSupplementResponse {
  return {
    source: "fixture",
    generatedAt: NOW,
    hiddenThreads: [],
    extraProjects: [],
    archivedCount: partial.archivedThreads?.length ?? 0,
    archivedTruncated: false,
    archivedParentIds: [],
    archivedThreads: [],
    threadFields: {},
    pendingFields: [],
    unavailableSources: [],
    ...partial,
  };
}

function build(
  visible: ThreadListEntry[],
  extra: Partial<FleetSupplementResponse> = {},
  filters: FleetFilters = EMPTY_FLEET_FILTERS,
) {
  return buildFleetModel({
    bootstrap: bootstrap(visible),
    supplement: supplement(extra),
    hosts: [],
    filters,
  });
}

describe("buildFleetModel lineage", () => {
  it("links side chats by source thread and child threads by parent", () => {
    const model = build([thread("p"), thread("c", { parentThreadId: "p" })], {
      hiddenThreads: [
        thread("s", {
          visibility: "hidden",
          originKind: "fork",
          originPluginId: "side-chat",
          sourceThreadId: "p",
        }),
      ],
    });
    expect(model.byId.get("c")?.kind).toBe("child");
    expect(model.byId.get("s")?.kind).toBe("side-chat");
    expect(model.byId.get("s")?.parentStatus).toBe("known");
    expect(
      model.projects[0]?.families[0]?.children
        .map((child) => child.thread.id)
        .sort(),
    ).toEqual(["c", "s"]);
  });

  it("marks workflow workers without a reported parent as parent unknown, never guessing", () => {
    const model = build([thread("p")], {
      hiddenThreads: [
        thread("w", { visibility: "hidden", originPluginId: "workflows" }),
      ],
      threadFields: { w: fields({ workflowParentThreadId: null }) },
    });
    const worker = model.byId.get("w");
    expect(worker?.kind).toBe("workflow");
    expect(worker?.parentStatus).toBe("unknown");
    expect(worker?.parentId).toBeNull();
  });

  it("treats a parent outside the accessible set as unknown", () => {
    const model = build([thread("c", { parentThreadId: "missing" })]);
    expect(model.byId.get("c")?.parentStatus).toBe("unknown");
    expect(
      model.projects[0]?.families.map((family) => family.thread.id),
    ).toEqual(["c"]);
  });
});

describe("buildFleetModel attention", () => {
  it("derives reasons from independent signals", () => {
    const model = build([
      thread("quiet"),
      thread("waiting", { hasPendingInteraction: true }),
      thread("failedQueue", { queuedWork: "failed" }),
      thread("error", { status: "error" }),
      thread("offline", {
        executionTarget: "local",
        runtime: {
          displayStatus: "waiting-for-host",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      thread("reply", {
        lastReadAt: NOW - 5000,
        latestAttentionAt: NOW - 1000,
      }),
      thread("workingUnread", {
        status: "active",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
        lastReadAt: null,
      }),
    ]);
    const reason = (id: string) => model.byId.get(id)?.attention;
    expect(reason("quiet")).toBeNull();
    expect(reason("waiting")).toBe("waiting");
    expect(reason("failedQueue")).toBe("failed");
    expect(reason("error")).toBe("failed");
    expect(reason("offline")).toBe("host-offline");
    expect(reason("reply")).toBe("new-reply");
    expect(reason("workingUnread")).toBeNull();
    expect(model.attention.map((t) => t.id)).toEqual([
      "waiting",
      "failedQueue",
      "error",
      "offline",
      "reply",
    ]);
  });

  it("never puts archived threads in attention and says offline, not error", () => {
    const model = build([], {
      archivedThreads: [
        thread("old", { archivedAt: NOW - 10, hasPendingInteraction: true }),
      ],
    });
    expect(model.byId.get("old")?.attention).toBeNull();
    const offline = build([
      thread("o", {
        executionTarget: "local",
        runtime: {
          displayStatus: "waiting-for-host",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ]);
    expect(stateWord(offline.byId.get("o")!).word).toBe("Host offline");
  });

  it("says Idle, never done, for an idle read thread", () => {
    expect(stateWord(build([thread("i")]).byId.get("i")!).word).toBe("Idle");
  });
});

describe("buildFleetModel filters and counts", () => {
  it("shows archived threads only under the archived filter", () => {
    const extra = {
      archivedThreads: [
        thread("a1", { archivedAt: NOW }),
        thread("a2", { archivedAt: NOW }),
      ],
    };
    expect(build([thread("o")], extra).shown).toBe(1);
    const archived = build([thread("o")], extra, {
      ...EMPTY_FLEET_FILTERS,
      state: "archived",
    });
    expect(archived.shown).toBe(2);
    expect(archived.total).toBe(2);
    expect(archived.attention).toEqual([]);
  });

  it("keeps ancestors visible as context without counting them as matches", () => {
    const model = build(
      [thread("p"), thread("c", { parentThreadId: "p" })],
      {
        threadFields: {
          p: fields(),
          c: fields({
            cloudSandbox: {
              state: "not-awake",
              lastSuccessfulCheckAt: NOW,
              lastCheckError: null,
            },
          }),
        },
      },
      { ...EMPTY_FLEET_FILTERS, state: "not-awake" },
    );
    expect(model.shown).toBe(1);
    expect(model.matchedIds.has("p")).toBe(false);
    expect(model.projects[0]?.families[0]?.thread.id).toBe("p");
  });

  it("counts sandbox state separately from runtime and by harness", () => {
    const model = build(
      [
        thread("a", {
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
        thread("b", { providerId: "codex" }),
        thread("c"),
        thread("d"),
      ],
      {
        threadFields: {
          a: fields(),
          b: fields(),
          c: fields({
            cloudSandbox: {
              state: "not-awake",
              lastSuccessfulCheckAt: NOW,
              lastCheckError: null,
            },
          }),
        },
      },
    );
    expect(model.counts.awake).toBe(2);
    expect(model.counts.awakeByHarness).toEqual({ "claude-code": 1, codex: 1 });
    expect(model.counts.notAwake).toBe(1);
    expect(model.counts.sandboxUnknown).toBe(1);
    expect(model.counts.working).toBe(1);
  });

  it("reports every field as pending when the supplement is unavailable", () => {
    const model = buildFleetModel({
      bootstrap: bootstrap([thread("x")]),
      supplement: undefined,
      hosts: [],
      filters: EMPTY_FLEET_FILTERS,
    });
    expect(model.source).toBe("unavailable");
    expect(model.pendingFields.has("configuredExecution")).toBe(true);
    expect(model.byId.get("x")?.sandbox).toBe("unknown");
  });
});

describe("createRedactor", () => {
  it("hides titles, project names and machine names when on", () => {
    const model = build([thread("x")]);
    const on = createRedactor(true, ["proj_a"], ["host_1"]);
    expect(on.title(model.byId.get("x")!)).toBe("Hidden title");
    expect(on.project("proj_a", "alpha")).toBe("Project 1");
    expect(on.host("host_1", "build-box")).toBe("Machine 1");
    expect(on.text("Approve deploy?")).toBeNull();
    const off = createRedactor(false, ["proj_a"], []);
    expect(off.title(model.byId.get("x")!)).toBe("Thread x");
  });
});

describe("buildFleetModel truth edges", () => {
  it("breaks parent cycles instead of dropping the threads", () => {
    const model = build([
      thread("x", { parentThreadId: "y" }),
      thread("y", { parentThreadId: "x" }),
    ]);
    expect(model.shown).toBe(2);
    const rendered = model.projects.flatMap((group) => {
      const ids: string[] = [];
      const walk = (family: (typeof group.families)[number]) => {
        ids.push(family.thread.id);
        family.children.forEach(walk);
      };
      group.families.forEach(walk);
      return ids;
    });
    expect(rendered.sort()).toEqual(["x", "y"]);
  });

  it("labels an active child of an archived parent instead of leaking the parent", () => {
    const model = build([thread("c", { parentThreadId: "old" })], {
      archivedThreads: [thread("old", { archivedAt: NOW })],
    });
    expect(model.byId.get("c")?.parentStatus).toBe("archived");
    expect(
      model.projects[0]?.families.map((family) => family.thread.id),
    ).toEqual(["c"]);
  });

  it("labels a parent archived from the live id list when archive rows are not loaded", () => {
    const model = build(
      [
        thread("c", { parentThreadId: "old" }),
        thread("gone", { parentThreadId: "missing" }),
      ],
      { archivedParentIds: ["old"] },
    );
    expect(model.byId.get("c")?.parentStatus).toBe("archived");
    expect(model.byId.get("gone")?.parentStatus).toBe("unknown");
  });

  it("follows the host unread rule: child threads never count as new replies", () => {
    const model = build([
      thread("p"),
      thread("c", { parentThreadId: "p", lastReadAt: NOW - 5000 }),
    ]);
    expect(model.byId.get("c")?.attention).toBeNull();
  });

  it("labels forks and unknown plugin threads honestly", () => {
    const model = build(
      [thread("p"), thread("f", { originKind: "fork", sourceThreadId: "p" })],
      {
        hiddenThreads: [
          thread("z", { visibility: "hidden", originPluginId: "some-plugin" }),
        ],
      },
    );
    expect(model.byId.get("f")?.kind).toBe("fork");
    expect(model.byId.get("z")?.kind).toBe("plugin");
  });

  it("does not match hidden names when search runs with privacy on", () => {
    const model = buildFleetModel({
      bootstrap: bootstrap([thread("x")]),
      supplement: supplement({}),
      hosts: [],
      filters: { ...EMPTY_FLEET_FILTERS, query: "Thread x" },
      searchNames: false,
    });
    expect(model.shown).toBe(0);
  });

  it("never prints Machine 0 for an unknown machine under privacy", () => {
    const on = createRedactor(true, [], ["host_1"]);
    expect(on.host(null, "secret")).toBe("Machine (name hidden)");
    expect(on.host("other", "secret")).toBe("Machine (name hidden)");
  });
});

describe("buildFleetModel sources", () => {
  it("names threads in hidden projects from the supplement", () => {
    const model = build([], {
      hiddenThreads: [thread("h", { projectId: "proj_hidden" })],
      extraProjects: [{ id: "proj_hidden", name: "Hidden one", hidden: true }],
    });
    expect(model.byId.get("h")?.projectName).toBe("Hidden one");
    expect(model.projectOptions).toContainEqual({
      id: "proj_hidden",
      name: "Hidden one",
      hidden: true,
    });
  });

  it("reports loading, not unsupported, while the supplement is in flight", () => {
    const model = buildFleetModel({
      bootstrap: bootstrap([thread("x")]),
      supplement: undefined,
      hosts: [],
      filters: EMPTY_FLEET_FILTERS,
      supplementLoading: true,
    });
    expect(model.source).toBe("loading");
    expect(model.pendingFields.size).toBe(0);
  });
});

describe("buildFleetModel runtime buckets", () => {
  const busy = {
    displayStatus: "active" as const,
    hostReconnectGraceExpiresAt: null,
  };
  const idleActivity = {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount: 0,
    activePlanModeCount: 0,
    activeGoalCount: 0,
  };

  it("treats pending as not running and background activity as working, like the sidebar", () => {
    const model = build([
      thread("pending", {
        status: "pending",
        runtime: {
          displayStatus: "pending",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      thread("bgcmd", {
        activity: { ...idleActivity, activeBackgroundCommandCount: 1 },
      }),
      thread("workflow", {
        activity: { ...idleActivity, activeWorkflowCount: 1 },
      }),
    ]);
    expect(model.byId.get("pending")?.runtime).toBe("idle");
    expect(model.byId.get("bgcmd")?.runtime).toBe("working");
    expect(model.byId.get("workflow")?.runtime).toBe("working");
  });

  it("does not double-count a failed queue on a busy thread, and buckets partition the open total", () => {
    const model = build([
      thread("busyFailedQueue", {
        status: "active",
        runtime: busy,
        queuedWork: "failed",
      }),
      thread("idleFailedQueue", { queuedWork: "failed" }),
      thread("waiting", { hasPendingInteraction: true }),
      thread("error", { status: "error" }),
      thread("starting", {
        status: "starting",
        runtime: {
          displayStatus: "starting",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      thread("quiet"),
    ]);
    expect(model.byId.get("busyFailedQueue")?.attention).toBeNull();
    expect(model.byId.get("busyFailedQueue")?.runtime).toBe("working");
    expect(model.byId.get("idleFailedQueue")?.attention).toBe("failed");
    const { attention, working, connecting, idle } = model.counts;
    expect(attention + working + connecting + idle).toBe(model.total);
  });

  it("says Archived for an archived thread even if it errored", () => {
    const model = build(
      [],
      {
        archivedThreads: [thread("old", { archivedAt: NOW, status: "error" })],
      },
      { ...EMPTY_FLEET_FILTERS, state: "archived" },
    );
    expect(stateWord(model.byId.get("old")!).word).toBe("Archived");
  });
});
