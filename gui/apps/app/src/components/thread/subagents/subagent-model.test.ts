import { describe, expect, it } from "vitest";
import { makeThreadListEntry as makeThreadListEntryFixture } from "@cloudroom/test-helpers/domain-fixtures";
import {
  buildSubagentTree,
  getSubagentBucket,
  getSubagentFlags,
  getSubagentStatus,
  getSubagentTask,
  summarizeSubagents,
  type SubagentEntry,
} from "./subagent-model";

function entry(
  id: string,
  parentThreadId: string | null,
  overrides: Partial<SubagentEntry> = {},
): SubagentEntry {
  return makeThreadListEntryFixture({ id, parentThreadId, createdAt: 1, ...overrides });
}

function display(status: SubagentEntry["runtime"]["displayStatus"]) {
  return { runtime: { displayStatus: status, hostReconnectGraceExpiresAt: null } };
}

describe("buildSubagentTree", () => {
  it("keeps direct children first and nests descendants under their real parent", () => {
    const roots = buildSubagentTree("root", [
      entry("b", "root", { createdAt: 2 }),
      entry("a", "root", { createdAt: 1 }),
      entry("a1", "a"),
      entry("a1x", "a1"),
      entry("other", "unrelated"),
      entry("root", null),
    ]);
    expect(roots.map((node) => node.entry.id)).toEqual(["a", "b"]);
    expect(roots[0]?.children.map((node) => node.entry.id)).toEqual(["a1"]);
    expect(roots[0]?.children[0]?.children.map((node) => node.entry.id)).toEqual(["a1x"]);
    expect(roots[0]?.descendantCount).toBe(2);
    expect(roots[1]?.descendantCount).toBe(0);
  });

  it("does not loop or duplicate on a parent cycle", () => {
    const roots = buildSubagentTree("root", [
      entry("a", "root"),
      entry("b", "a"),
      entry("a", "b"),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.descendantCount).toBe(1);
  });
});

describe("summarizeSubagents", () => {
  const entries = [
    entry("a", "root", display("active")),
    entry("b", "root", { ...display("idle"), hasPendingInteraction: true }),
    entry("b1", "b", display("error")),
  ];

  it("separates direct and nested counts and buckets direct children only", () => {
    const summary = summarizeSubagents(buildSubagentTree("root", entries));
    expect(summary.directCount).toBe(2);
    expect(summary.nestedCount).toBe(1);
    expect(summary.buckets).toMatchObject({ working: 1, "needs-input": 1, failed: 0, idle: 0 });
  });

  it("leaves nested counts unknown when only direct children were loaded", () => {
    const roots = buildSubagentTree("root", entries.slice(0, 2), "direct-only");
    expect(summarizeSubagents(roots, "direct-only").nestedCount).toBeNull();
    expect(roots[0]?.descendantCount).toBeNull();
  });
});

describe("status truth", () => {
  it("never calls an idle thread done", () => {
    const status = getSubagentStatus(entry("a", "root", display("idle")));
    expect(status.label).toBe("Idle");
    expect(status.detail).toMatch(/outcome not recorded/);
    expect(status.running).toBe(false);
  });

  it("keeps host states distinct from working", () => {
    for (const value of ["host-reconnecting", "waiting-for-host"] as const) {
      const thread = entry("a", "root", display(value));
      expect(getSubagentBucket(thread)).toBe("host");
      expect(getSubagentStatus(thread).tone).toBe("attention");
    }
    expect(getSubagentStatus(entry("a", "root", display("host-reconnecting"))).running).toBe(true);
    expect(getSubagentStatus(entry("a", "root", display("waiting-for-host"))).running).toBe(false);
  });

  it("puts pending input ahead of runtime state without hiding the runtime label", () => {
    const thread = entry("a", "root", { ...display("active"), hasPendingInteraction: true });
    expect(getSubagentBucket(thread)).toBe("needs-input");
    expect(getSubagentStatus(thread).label).toBe("Active");
  });

  it("flags background work on an idle thread without calling it working", () => {
    const thread = entry("a", "root", {
      ...display("idle"),
      activity: {
        activeBackgroundAgentCount: 1,
        activeBackgroundCommandCount: 1,
        activePlanModeCount: 0,
        activeGoalCount: 1,
        activeWorkflowCount: 0,
      },
    });
    expect(getSubagentBucket(thread)).toBe("idle");
    expect(getSubagentFlags(thread).map((flag) => flag.label)).toEqual(["2 background tasks"]);
  });
});

describe("getSubagentTask", () => {
  it("shows the recorded first prompt as the task when it differs from the title", () => {
    expect(
      getSubagentTask(entry("a", "root", { title: "Review", titleFallback: "Review the PR" })),
    ).toEqual({ title: "Review", task: "Review the PR" });
  });

  it("does not invent a task when none is recorded", () => {
    expect(getSubagentTask(entry("thr_abcdefgh", "root", { title: null, titleFallback: null }))).toEqual({
      title: "Thread thr_abcd",
      task: null,
    });
  });
});
