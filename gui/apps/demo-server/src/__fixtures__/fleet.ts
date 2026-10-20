import type { Host, ThreadListEntry } from "@cloudroom/domain";
import type {
  EnvironmentPullRequestResponse,
  FleetSupplementResponse,
  FleetThreadFields,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  ThreadTimelineResponse,
} from "@cloudroom/server-contract";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const FLEET_MAC_HOST_ID = "host_fleetmac001";
export const FLEET_SSH_HOST_ID = "host_fleetssh001";
const PERSONAL_ID = "proj_fleetpersonal";

const PROJECTS = [
  ["proj_fleet0001", "dot-context"],
  ["proj_fleet0002", "cloudroom-ui"],
  ["proj_fleet0003", "cloudroom-core"],
  ["proj_fleet0004", "api-gateway"],
  ["proj_fleet0005", "docs-site"],
  ["proj_fleet0006", "mobile-app"],
] as const;

type Harness = "claude-code" | "codex";
type Where = "cloud" | "mac" | "ssh";
type Sandbox = "awake" | "not-awake" | "unknown" | "new";
type Run =
  | "working"
  | "idle"
  | "error"
  | "starting"
  | "reconnecting"
  | "offline";

interface Spec {
  id: string;
  project: number;
  title: string;
  harness: Harness;
  where: Where;
  sandbox?: Sandbox;
  run: Run;
  ageMin: number;
  parent?: string;
  source?: string;
  origin?: "side-chat" | "workflow";
  workflowParent?: string | null;
  input?: "approval" | "question";
  inputSummary?: string;
  errorSummary?: string;
  activity?: string;
  unread?: boolean;
  queue?: "waiting" | "failed";
  bgAgents?: number;
  planMode?: boolean;
  pinned?: boolean;
  archived?: boolean;
  fallback?: string;
  pr?: boolean;
}

const CLAUDE_MODELS = [
  ["claude-opus-5-5[1m]", "high"],
  ["claude-haiku-5-5", "xhigh"],
  ["claude-sonnet-5-5", "medium"],
  ["claude-opus-5-5", "medium"],
] as const;
const CODEX_MODELS = [
  ["gpt-6.1-sol", "medium"],
  ["gpt-6-luna", "high"],
] as const;

const WORK_TITLES = [
  "Refactor auth middleware into a typed pipeline",
  "Add pagination to the audit log endpoint",
  "Investigate flaky websocket reconnect test",
  "Port settings page to the shared form kit",
  "Write migration for project sort keys",
  "Profile cold start of the desktop app",
  "Tighten CSP headers for the preview server",
  "Split the timeline renderer into lazy chunks",
  "Document the plugin RPC contract",
  "Fix iOS Safari drawer jump on keyboard open",
  "Backfill thread purpose for imported sessions",
  "Harden retry policy for GitHub sync",
  "Add keyboard shortcuts to the command palette",
  "Replace polling with realtime for hosts list",
  "Audit bundle budget after icon change",
  "Rewrite changelog parser tests",
  "Handle disk-full during history save",
  "Normalize provider usage windows",
  "Add empty states to the skills browser",
  "Investigate memory growth in the host daemon",
  "Cache workspace status per environment",
  "Translate onboarding copy",
  "Add VoiceOver labels to sidebar rows",
  "Speed up search index rebuild",
  "Clean up legacy automation routes",
  "Verify teleport resume after sleep",
  "Add contract tests for sidebar bootstrap",
  "Reduce re-renders in split panes",
  "Migrate icons to the new set",
  "Write release notes draft",
];

function specs(): Spec[] {
  const list: Spec[] = [];
  const fam = (s: Spec) => list.push(s);
  fam({
    id: "thr_fleet001",
    project: 0,
    title: "SF1 S4 T1 issue 202",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.3,
    activity: "Running: pnpm test contracts",
    bgAgents: 2,
    queue: "waiting",
    planMode: true,
    pinned: true,
    pr: true,
  });
  fam({
    id: "thr_fleet002",
    project: 0,
    parent: "thr_fleet001",
    title: "S4-T1 C1 review: contract",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 2,
    input: "approval",
    inputSummary: "Approve: run full validator (about 10 min)?",
  });
  fam({
    id: "thr_fleet003",
    project: 0,
    parent: "thr_fleet001",
    title: "S4-T1 C1 review: tests-scope",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.7,
    activity: "Background command running",
  });
  fam({
    id: "thr_fleet004",
    project: 0,
    parent: "thr_fleet001",
    title: "S4-T1 C1 review: adversarial",
    harness: "claude-code",
    where: "cloud",
    sandbox: "not-awake",
    run: "idle",
    ageMin: 4,
    unread: true,
  });
  fam({
    id: "thr_fleet005",
    project: 0,
    source: "thr_fleet001",
    origin: "side-chat",
    title: "Side chat: why did the contract tests fail?",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 7,
  });
  fam({
    id: "thr_fleet006",
    project: 0,
    title:
      "SF1 S2 T2 — offline cache replay and conflict resolution plan for multi-device sessions",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 6,
  });
  fam({
    id: "thr_fleet007",
    project: 0,
    parent: "thr_fleet006",
    title: "SF1 S2 T2 — independent verification",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.25,
  });
  fam({
    id: "thr_fleet008",
    project: 0,
    parent: "thr_fleet007",
    title: "Luna family check",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.15,
  });
  fam({
    id: "thr_fleet009",
    project: 0,
    parent: "thr_fleet007",
    title: "Luna reconciliation",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "error",
    ageMin: 1,
    errorSummary: "Turn failed: provider rate limit",
    queue: "failed",
  });
  fam({
    id: "thr_fleet010",
    project: 0,
    origin: "workflow",
    workflowParent: "thr_fleet006",
    title: "Workflow worker: replay fixtures against cache v2",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.2,
    activity: "Running: replay-fixtures.sh",
  });
  fam({
    id: "thr_fleet011",
    project: 2,
    title: "Core 0.1.66 release checklist",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 1,
    activity: "Editing CHANGELOG.md",
    bgAgents: 1,
  });
  fam({
    id: "thr_fleet012",
    project: 2,
    parent: "thr_fleet011",
    title: "Verify Cursor harness in Cloud",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.5,
  });
  fam({
    id: "thr_fleet013",
    project: 2,
    parent: "thr_fleet011",
    title: "Verify OpenClaw in Cloud threads",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 9,
    input: "question",
    inputSummary: "Which sandbox image should the smoke test use?",
  });
  fam({
    id: "thr_fleet014",
    project: 2,
    parent: "thr_fleet011",
    title: "Draft release notes",
    harness: "claude-code",
    where: "cloud",
    sandbox: "not-awake",
    run: "idle",
    ageMin: 33,
  });
  fam({
    id: "thr_fleet015",
    project: 2,
    origin: "workflow",
    workflowParent: "thr_fleet011",
    title: "Workflow worker: build linux-x64",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.4,
    activity: "Running: cargo build --release",
  });
  fam({
    id: "thr_fleet016",
    project: 2,
    origin: "workflow",
    workflowParent: "thr_fleet011",
    title: "Workflow worker: build linux-arm64",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 3,
  });
  fam({
    id: "thr_fleet017",
    project: 3,
    title: "Rate limiter redesign",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 12,
    unread: true,
  });
  fam({
    id: "thr_fleet018",
    project: 3,
    parent: "thr_fleet017",
    title: "Benchmark token bucket vs sliding window",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 0.6,
  });
  fam({
    id: "thr_fleet019",
    project: 3,
    parent: "thr_fleet017",
    title: "Write load test harness",
    harness: "claude-code",
    where: "cloud",
    sandbox: "not-awake",
    run: "idle",
    ageMin: 50,
  });
  fam({
    id: "thr_fleet020",
    project: 3,
    origin: "workflow",
    workflowParent: null,
    title: "Workflow worker: nightly fuzz shard 3",
    harness: "codex",
    where: "cloud",
    sandbox: "awake",
    run: "working",
    ageMin: 2,
  });
  fam({
    id: "thr_fleet021",
    project: 4,
    title: "Rewrite the self-hosting guide",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 15,
  });
  fam({
    id: "thr_fleet022",
    project: 4,
    source: "thr_fleet021",
    origin: "side-chat",
    title: "Side chat: is Tailscale Serve still recommended?",
    harness: "claude-code",
    where: "cloud",
    sandbox: "awake",
    run: "idle",
    ageMin: 14,
    unread: true,
  });
  fam({
    id: "thr_fleet023",
    project: 1,
    title: "Mobile drawer regression on iOS Safari",
    harness: "claude-code",
    where: "mac",
    run: "idle",
    ageMin: 12,
    unread: true,
    fallback: "claude-sonnet-5-5",
  });
  fam({
    id: "thr_fleet024",
    project: 1,
    title: "Fleet view working preview",
    harness: "claude-code",
    where: "mac",
    run: "working",
    ageMin: 0.1,
    activity: "Editing FleetView.tsx",
  });
  fam({
    id: "thr_fleet025",
    project: 2,
    title: "Core 0.1.66 release notes draft",
    harness: "claude-code",
    where: "mac",
    run: "reconnecting",
    ageMin: 0.8,
  });
  fam({
    id: "thr_fleet026",
    project: 1,
    title: "compose Twitter banner from brand assets",
    harness: "codex",
    where: "ssh",
    run: "offline",
    ageMin: 29,
  });
  fam({
    id: "thr_fleet027",
    project: 5,
    title: "Crash on Android 15 share sheet",
    harness: "codex",
    where: "ssh",
    run: "offline",
    ageMin: 41,
  });
  fam({
    id: "thr_fleet028",
    project: 5,
    title: "Hidden-title check",
    harness: "claude-code",
    where: "mac",
    run: "idle",
    ageMin: 60,
  });
  fam({
    id: "thr_fleet029",
    project: 2,
    title: "Disposable sandbox smoke test",
    harness: "codex",
    where: "cloud",
    sandbox: "unknown",
    run: "idle",
    ageMin: 180,
  });
  fam({
    id: "thr_fleet030",
    project: 2,
    title: "New thread",
    harness: "claude-code",
    where: "cloud",
    sandbox: "new",
    run: "starting",
    ageMin: 0,
  });

  const awake = () => list.filter((s) => s.sandbox === "awake" && !s.archived);
  let n = 31;
  let t = 0;
  const nextId = () => `thr_fleet${String(n++).padStart(3, "0")}`;
  while (awake().filter((s) => s.harness === "claude-code").length < 33) {
    const i = t++;
    const working = i % 3 !== 2;
    list.push({
      id: nextId(),
      project: i % 6,
      title: WORK_TITLES[i % WORK_TITLES.length],
      harness: "claude-code",
      where: "cloud",
      sandbox: "awake",
      run: working ? "working" : "idle",
      ageMin: working ? 0.2 + (i % 7) * 0.3 : 5 + i,
      activity: working ? "Editing files" : undefined,
    });
  }
  while (awake().filter((s) => s.harness === "codex").length < 11) {
    const i = t++;
    list.push({
      id: nextId(),
      project: (i + 2) % 6,
      title: WORK_TITLES[i % WORK_TITLES.length],
      harness: "codex",
      where: "cloud",
      sandbox: "awake",
      run: i % 2 === 0 ? "working" : "idle",
      ageMin: 1 + i,
      activity: i % 2 === 0 ? "Running tests" : undefined,
    });
  }
  while (
    list.filter((s) => s.sandbox === "not-awake" && !s.archived).length < 14
  ) {
    const i = t++;
    list.push({
      id: nextId(),
      project: (i + 1) % 6,
      title: WORK_TITLES[i % WORK_TITLES.length],
      harness: i % 4 === 0 ? "codex" : "claude-code",
      where: "cloud",
      sandbox: "not-awake",
      run: "idle",
      ageMin: 60 + i * 7,
      unread: i % 5 === 0,
    });
  }
  for (let i = 0; i < 13; i += 1) {
    list.push({
      id: nextId(),
      project: i % 6,
      title: `Archived: ${WORK_TITLES[(i * 7) % WORK_TITLES.length]}`,
      harness: i % 3 === 0 ? "codex" : "claude-code",
      where: "cloud",
      sandbox: "not-awake",
      run: "idle",
      ageMin: (2 * DAY) / MINUTE + i * 90,
      archived: true,
    });
  }
  return list;
}

function model(spec: Spec) {
  const table = spec.harness === "codex" ? CODEX_MODELS : CLAUDE_MODELS;
  const index = Number(spec.id.slice(-3)) % table.length;
  return table[index];
}

function entry(spec: Spec, now: number): ThreadListEntry {
  const updatedAt = now - Math.round(spec.ageMin * MINUTE);
  const status =
    spec.run === "working" || spec.run === "reconnecting"
      ? "active"
      : spec.run === "error"
        ? "error"
        : spec.run === "starting"
          ? "starting"
          : "idle";
  const displayStatus =
    spec.run === "reconnecting"
      ? "host-reconnecting"
      : spec.run === "offline"
        ? "waiting-for-host"
        : spec.run === "starting"
          ? "provisioning"
          : status;
  const hidden = spec.origin !== undefined;
  return {
    id: spec.id,
    executionTarget: spec.where === "cloud" ? "cloud" : "local",
    projectId: PROJECTS[spec.project][0],
    environmentId: `env_${spec.id.slice(4)}`,
    providerId: spec.harness,
    title: spec.title,
    titleFallback: spec.title,
    sectionId: null,
    status,
    parentThreadId: spec.parent ?? null,
    sourceThreadId: spec.source ?? null,
    originKind: spec.origin === "side-chat" ? "fork" : null,
    originPluginId:
      spec.origin === "side-chat"
        ? "side-chat"
        : spec.origin === "workflow"
          ? "workflows"
          : null,
    visibility: hidden ? "hidden" : "visible",
    archivedAt: spec.archived ? updatedAt : null,
    pinnedAt: spec.pinned ? now - DAY : null,
    deletedAt: null,
    lastReadAt: spec.unread ? updatedAt - MINUTE : updatedAt + 1,
    latestAttentionAt: updatedAt,
    createdAt: updatedAt - 3 * 60 * MINUTE,
    updatedAt,
    runtime: {
      displayStatus,
      hostReconnectGraceExpiresAt:
        spec.run === "reconnecting" ? now + 100_000 : null,
    },
    activity: {
      activeWorkflowCount: list(spec).workflowCount,
      activeBackgroundAgentCount: spec.bgAgents ?? 0,
      activeBackgroundCommandCount:
        spec.activity === "Background command running" ? 1 : 0,
      activePlanModeCount: spec.planMode ? 1 : 0,
      activeGoalCount: 0,
    },
    queuedWork: spec.queue ?? "none",
    pinSortKey: spec.pinned ? "a0" : null,
    hasPendingInteraction: spec.input !== undefined,
    environmentHostId:
      spec.where === "mac"
        ? FLEET_MAC_HOST_ID
        : spec.where === "ssh"
          ? FLEET_SSH_HOST_ID
          : null,
    environmentName: null,
    environmentBranchName: `room/${spec.id.slice(4)}`,
    environmentPath: null,
    environmentProviderId: spec.where === "cloud" ? "cloudroom" : null,
    environmentIsWorktree: null,
    environmentWorkspaceDisplayKind: "other",
  };
}

let SPECS: Spec[] | null = null;
function allSpecs(): Spec[] {
  SPECS ??= specs();
  return SPECS;
}
function list(spec: Spec) {
  const workflowCount = allSpecs().filter(
    (s) =>
      s.origin === "workflow" &&
      s.workflowParent === spec.id &&
      s.run === "working",
  ).length;
  return { workflowCount };
}

function fields(spec: Spec, now: number): FleetThreadFields {
  const [configuredModel, configuredReasoning] = model(spec);
  return {
    configuredModel,
    configuredReasoning,
    inputKind: spec.input ?? null,
    inputSummary: spec.inputSummary ?? null,
    lastErrorSummary: spec.errorSummary ?? null,
    latestActivityLabel: spec.activity ?? null,
    fallbackModel: spec.fallback ?? null,
    cloudSandbox:
      spec.where !== "cloud"
        ? null
        : spec.sandbox === "unknown"
          ? {
              state: "unknown",
              lastSuccessfulCheckAt: null,
              lastCheckError: "Sandbox not in the last awake list",
            }
          : spec.sandbox === "new"
            ? {
                state: "unknown",
                lastSuccessfulCheckAt: now - 40_000,
                lastCheckError: null,
              }
            : {
                state: spec.sandbox === "awake" ? "awake" : "not-awake",
                lastSuccessfulCheckAt: now - 40_000,
                lastCheckError: null,
              },
    workflowParentThreadId:
      spec.origin === "workflow" ? (spec.workflowParent ?? null) : null,
  };
}

export function fleetBootstrap(now: number): SidebarBootstrapResponse {
  const open = allSpecs().filter((s) => !s.archived && s.origin === undefined);
  const projects: ProjectWithThreadsResponse[] = PROJECTS.map(([id, name]) => ({
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    createdAt: now - 30 * DAY,
    updatedAt: now,
    sources: [],
    threads: open
      .filter((s) => PROJECTS[s.project][0] === id)
      .map((s) => entry(s, now)),
    defaultExecutionOptions: null,
  }));
  return {
    sections: [],
    projects,
    personalProject: {
      id: PERSONAL_ID,
      kind: "standard",
      name: "Personal",
      gitRemoteUrl: null,
      createdAt: now - 30 * DAY,
      updatedAt: now - 30 * DAY,
      sources: [],
      threads: [],
      defaultExecutionOptions: null,
    },
  };
}

export function fleetSupplement(
  now: number,
  includeArchived = false,
): FleetSupplementResponse {
  const all = allSpecs();
  return {
    source: "fixture",
    generatedAt: now - 40_000,
    hiddenThreads: all
      .filter((s) => !s.archived && s.origin !== undefined)
      .map((s) => entry(s, now)),
    extraProjects: [],
    archivedThreads: includeArchived
      ? all.filter((s) => s.archived).map((s) => entry(s, now))
      : [],
    archivedCount: all.filter((s) => s.archived).length,
    archivedTruncated: false,
    threadFields: Object.fromEntries(all.map((s) => [s.id, fields(s, now)])),
    pendingFields: [],
    unavailableSources: [
      "Threads on other Macs' servers (sample: MacBook Air runs its own)",
      "Agents run outside Cloudroom",
    ],
  };
}

export function fleetHosts(now: number): Host[] {
  const base = {
    type: "persistent" as const,
    machineProviderId: null,
    lifecycle: {
      phase: "active" as const,
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full" as const,
    lastRejectedProtocolVersion: null,
    createdAt: now - 30 * DAY,
    updatedAt: now,
  };
  return [
    {
      ...base,
      id: FLEET_MAC_HOST_ID,
      name: "This Mac (sample)",
      status: "connected",
      lastSeenAt: now,
    },
    {
      ...base,
      id: FLEET_SSH_HOST_ID,
      name: "build-box (SSH, sample)",
      status: "disconnected",
      lastSeenAt: now - 29 * MINUTE,
    },
  ];
}

export function isFleetThreadId(id: string): boolean {
  return allSpecs().some((s) => s.id === id);
}

export function fleetThread(id: string, now: number): ThreadListEntry | null {
  const spec = allSpecs().find((s) => s.id === id);
  return spec ? entry(spec, now) : null;
}

export function fleetTimeline(id: string, now: number): ThreadTimelineResponse {
  const spec = allSpecs().find((s) => s.id === id);
  const [configured] = spec ? model(spec) : ["unknown"];
  return {
    rows: [],
    contextBoundarySeq: null,
    completedTurnDisplay: "flat",
    maxSeq: 0,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: spec?.planMode
      ? {
          sourceSeq: 0,
          updatedAt: now - 2 * MINUTE,
          items: [
            {
              id: "t1",
              text: "Reproduce the failing contract test",
              status: "completed",
            },
            { id: "t2", text: "Fix input_id mismatch", status: "completed" },
            {
              id: "t3",
              text: "Handle epoch-0 timestamps",
              status: "completed",
            },
            {
              id: "t4",
              text: "Regenerate projection fixture",
              status: "completed",
            },
            { id: "t5", text: "Run full validator", status: "in_progress" },
            {
              id: "t6",
              text: "Freeze candidate for review",
              status: "pending",
            },
          ],
        }
      : null,
    goal: null,
    modelFallback: spec?.fallback
      ? {
          sourceSeq: 0,
          detectedAt: now - 12 * MINUTE,
          originalModel: configured,
          fallbackModel: spec.fallback,
          reason: "provider",
          message: "Sample: provider fell back for the last turn.",
        }
      : null,
    contextWindowUsage: spec?.planMode
      ? { estimated: false, modelContextWindow: 1_000_000, usedTokens: 612_000 }
      : undefined,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

export function fleetPullRequest(
  environmentId: string,
): EnvironmentPullRequestResponse {
  if (environmentId !== "env_fleet001") return { outcome: "absent" };
  return {
    outcome: "available",
    pullRequest: {
      number: 214,
      title: "SF1 S4: contract fixes (sample)",
      state: "draft",
      url: "https://github.com/example/dot-context/pull/214",
      baseRefName: "main",
      headRefName: "room/fleet001",
      updatedAt: new Date(Date.UTC(2026, 9, 20, 4, 25)).toISOString(),
      checks: {
        state: "pending",
        totalCount: 5,
        passedCount: 2,
        failedCount: 0,
        pendingCount: 3,
      },
      review: { state: "none", reviewRequestCount: 0 },
      mergeability: { state: "draft", mergeStateStatus: null, mergeable: null },
      attention: "draft",
    },
  };
}
