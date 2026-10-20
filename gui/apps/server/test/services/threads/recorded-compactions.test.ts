import { describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  THREAD_IMPORT_OPERATION,
  threadScope,
  turnScope,
  type Thread,
  type ThreadEventType,
} from "@cloudroom/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@cloudroom/db";
import {
  buildRecordedCompactions,
  RECORDED_COMPACTIONS_LIST_LIMIT,
} from "../../../src/services/threads/recorded-compactions.js";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";

type ThreadOverrides = Partial<
  Pick<Thread, "executionTarget" | "originKind" | "providerId" | "status">
>;

function setup(overrides: ThreadOverrides = {}) {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const create = (extra: ThreadOverrides = {}) =>
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "claude-code",
      status: "idle",
      ...overrides,
      ...extra,
    });
  return { db, thread: create(), create };
}

let sequenceByThread = new Map<string, number>();

function append(
  db: DbConnection,
  thread: Thread,
  type: ThreadEventType,
  turnId: string | null,
  data: Record<string, unknown> = {},
  item?: { id: string; kind: "contextCompaction" },
) {
  const sequence = (sequenceByThread.get(thread.id) ?? 0) + 1;
  sequenceByThread.set(thread.id, sequence);
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence,
      type,
      scope: turnId === null ? threadScope() : turnScope(turnId),
      itemId: item?.id ?? null,
      itemKind: item?.kind ?? null,
      parentToolCallId: null,
      createdAt: 1_000 * sequence,
      data: JSON.stringify({
        type,
        threadId: thread.id,
        providerThreadId: "p",
        ...(item ? { item: { type: item.kind, id: item.id } } : {}),
        ...data,
      }),
    },
  ]);
  return sequence;
}

function compactionItem(
  db: DbConnection,
  thread: Thread,
  phase: "item/started" | "item/completed",
  turnId: string,
  itemId: string,
) {
  return append(
    db,
    thread,
    phase,
    turnId,
    {},
    {
      id: itemId,
      kind: "contextCompaction",
    },
  );
}

function marker(
  db: DbConnection,
  thread: Thread,
  turnId: string,
  itemId?: string,
) {
  return append(
    db,
    thread,
    "thread/compacted",
    turnId,
    itemId ? { itemId } : {},
  );
}

function operation(
  db: DbConnection,
  thread: Thread,
  name: string,
  status = "completed",
) {
  return append(db, thread, "system/operation", null, {
    operation: name,
    operationId: `${name}-${Math.random()}`,
    status,
    message: name,
  });
}

function build(db: DbConnection, thread: Thread) {
  return buildRecordedCompactions(
    db,
    thread,
    sequenceByThread.get(thread.id) ?? 0,
  );
}

function compactions(list: ReturnType<typeof build>) {
  return list.entries.filter((entry) => entry.kind === "compaction");
}

describe("recorded compactions", () => {
  it("counts one compaction for begin, end, marker and replayed equivalents", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    append(db, thread, "turn/started", "t1");
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1", "c1");
    compactionItem(db, thread, "item/completed", "t1", "c1");
    marker(db, thread, "t1", "c1");
    compactionItem(db, thread, "item/completed", "t1", "c1");
    append(db, thread, "turn/completed", "t1", { status: "completed" });

    const list = build(db, thread);
    expect(list.completedCount).toBe(1);
    expect(compactions(list)).toEqual([
      expect.objectContaining({
        id: "c1",
        status: "completed",
        startedAt: 2_000,
        completedAt: 3_000,
        summary: null,
      }),
    ]);
    expect(list.coverage).toBe("complete");
    expect(list.gaps).toEqual([]);
  });

  it("keeps two compactions in one turn distinct when markers carry item ids", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    append(db, thread, "turn/started", "t1");
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1", "c1");
    compactionItem(db, thread, "item/completed", "t1", "c1");
    compactionItem(db, thread, "item/started", "t1", "c2");
    marker(db, thread, "t1", "c2");
    compactionItem(db, thread, "item/completed", "t1", "c2");

    const list = build(db, thread);
    expect(list.completedCount).toBe(2);
    expect(list.gaps).toEqual([]);
  });

  it("pairs legacy markers without item ids and flags ambiguity honestly", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1");
    compactionItem(db, thread, "item/completed", "t1", "c1");
    expect(build(db, thread)).toMatchObject({
      completedCount: 1,
      coverage: "complete",
    });

    compactionItem(db, thread, "item/started", "t2", "c2");
    compactionItem(db, thread, "item/started", "t2", "c3");
    marker(db, thread, "t2");
    marker(db, thread, "t2");
    marker(db, thread, "t2");
    const ambiguous = build(db, thread);
    expect(ambiguous.completedCount).toBe(3);
    expect(ambiguous.coverage).toBe("partial");
    expect(ambiguous.gaps).toContain("ambiguous-legacy");
  });

  it("pairs a forked marker that precedes its copied item instead of double counting", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup({ originKind: "fork" });
    marker(db, thread, "t1");
    compactionItem(db, thread, "item/completed", "t1", "c1");

    const list = build(db, thread);
    expect(list.completedCount).toBe(1);
    expect(compactions(list)).toEqual([
      expect.objectContaining({
        id: "c1",
        status: "completed",
        startedAt: null,
      }),
    ]);
    expect(list.gaps).toEqual(["forked"]);
  });

  it("does not count items without a confirming marker and does not invent a failure", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup({ providerId: "pi" });
    append(db, thread, "turn/started", "t1");
    compactionItem(db, thread, "item/started", "t1", "c1");
    append(db, thread, "provider/error", "t1", {
      message: "Context compaction failed",
    });
    append(db, thread, "turn/completed", "t1", { status: "completed" });

    const list = build(db, thread);
    expect(list.completedCount).toBe(0);
    expect(list.inProgress).toBe(false);
    expect(compactions(list)).toEqual([
      expect.objectContaining({ id: "c1", status: "unconfirmed" }),
    ]);
  });

  it("reports an in-progress compaction only for the active turn of a running thread", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup({ status: "active" });
    append(db, thread, "turn/started", "t1");
    compactionItem(db, thread, "item/started", "t1", "c1");

    const running = build(db, thread);
    expect(running).toMatchObject({ inProgress: true, completedCount: 0 });
    expect(compactions(running)).toEqual([
      expect.objectContaining({ status: "in_progress" }),
    ]);

    const idle = build(db, { ...thread, status: "idle" });
    expect(idle.inProgress).toBe(false);
    expect(compactions(idle)).toEqual([
      expect.objectContaining({ status: "unconfirmed" }),
    ]);
  });

  it("shows clears as dividers, collapses one clear reported by both sources, and never counts them", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1", "c1");
    operation(db, thread, THREAD_CONTEXT_CLEAR_OPERATION);
    operation(db, thread, THREAD_CONTEXT_CLEAR_OPERATION, "pending");
    append(db, thread, "thread/context/cleared", "t2");
    compactionItem(db, thread, "item/started", "t3", "c2");
    marker(db, thread, "t3", "c2");

    const list = build(db, thread);
    expect(list.completedCount).toBe(2);
    expect(list.entries.map((entry) => entry.kind)).toEqual([
      "compaction",
      "clear",
      "compaction",
    ]);
    append(db, thread, "thread/context/cleared", "t4");
    expect(build(db, thread).entries.map((entry) => entry.kind)).toEqual([
      "clear",
      "compaction",
      "clear",
      "compaction",
    ]);
    expect(list.entries[0]).toMatchObject({ id: "c2" });
  });

  it("marks incomplete history as partial with a reason per gap", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup({
      executionTarget: "cloud",
      providerId: "claude-code",
    });
    operation(db, thread, THREAD_IMPORT_OPERATION);
    operation(db, thread, "teleport");
    operation(db, thread, "edit_message");
    append(db, thread, "provider/unhandled", null, {
      providerId: "claude-code",
      rawType: "system:compact_boundary",
      rawEvent: {},
    });

    expect(build(db, thread)).toMatchObject({
      coverage: "partial",
      completedCount: 0,
      gaps: [
        "cloud-auto-not-reported",
        "imported-history",
        "provider-unverified",
        "rewound",
        "teleported",
        "unhandled-compaction-event",
      ],
    });

    const reported = setup();
    compactionItem(reported.db, reported.thread, "item/started", "t1", "c1");
    expect(build(reported.db, reported.thread).gaps).toEqual([]);
  });

  it("never infers a compaction from a token drop", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    append(db, thread, "thread/contextWindowUsage/updated", "t1", {
      contextWindowUsage: {
        usedTokens: 190_000,
        modelContextWindow: 200_000,
        estimated: false,
      },
    });
    append(db, thread, "thread/contextWindowUsage/updated", "t2", {
      contextWindowUsage: {
        usedTokens: 12_000,
        modelContextWindow: 200_000,
        estimated: false,
      },
    });
    expect(build(db, thread)).toMatchObject({
      completedCount: 0,
      entries: [],
    });
  });

  it("keeps each thread's history separate", () => {
    sequenceByThread = new Map();
    const { db, thread, create } = setup();
    const other = create();
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1", "c1");

    expect(build(db, thread).completedCount).toBe(1);
    expect(build(db, other)).toMatchObject({ completedCount: 0, entries: [] });
    expect(build(db, other).revision).not.toBe(build(db, thread).revision);
  });

  it("returns the newest 50 entries with the full count and flags truncation", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    for (
      let index = 0;
      index < RECORDED_COMPACTIONS_LIST_LIMIT + 5;
      index += 1
    ) {
      compactionItem(db, thread, "item/started", `t${index}`, `c${index}`);
      marker(db, thread, `t${index}`, `c${index}`);
    }
    const list = build(db, thread);
    expect(list.completedCount).toBe(RECORDED_COMPACTIONS_LIST_LIMIT + 5);
    expect(list.entries).toHaveLength(RECORDED_COMPACTIONS_LIST_LIMIT);
    expect(list.entries[0]).toMatchObject({ id: "c54" });
    expect(list.truncated).toBe(true);
  });

  it("changes revision only when compaction history changes and matches the timeline summary", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    compactionItem(db, thread, "item/started", "t1", "c1");
    marker(db, thread, "t1", "c1");
    const first = build(db, thread);
    append(db, thread, "turn/started", "t2");
    expect(build(db, thread).revision).toBe(first.revision);

    const summary = buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      eventBudget: 1_000,
      includeNestedRows: true,
      includeDiagnosticOperations: false,
      maxInlineOutputChars: null,
      maxSeq: sequenceByThread.get(thread.id) ?? 0,
      page: { kind: "latest", segmentLimit: 20 },
    }).response.recordedCompactions;
    expect(summary).toEqual({
      revision: first.revision,
      coverage: "complete",
      gaps: [],
      completedCount: 1,
      inProgress: false,
    });

    operation(db, thread, "edit_message");
    expect(build(db, thread).revision).not.toBe(first.revision);
  });

  it("ends an in-progress compaction when its item closes or its compaction error arrives", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup({ status: "active", providerId: "pi" });
    append(db, thread, "turn/started", "t1");
    compactionItem(db, thread, "item/started", "t1", "c1");
    expect(build(db, thread).inProgress).toBe(true);
    append(db, thread, "provider/error", "t1", {
      message: "Context compaction failed",
    });
    const failed = build(db, thread);
    expect(failed).toMatchObject({ inProgress: false, completedCount: 0 });
    expect(compactions(failed)).toEqual([
      expect.objectContaining({ id: "c1", status: "unconfirmed" }),
    ]);

    compactionItem(db, thread, "item/started", "t1", "c2");
    append(db, thread, "provider/warning", "t1", {
      category: "compaction-skipped",
      summary: "Context compaction skipped",
    });
    compactionItem(db, thread, "item/started", "t1", "c3");
    compactionItem(db, thread, "item/completed", "t1", "c3");
    expect(build(db, thread)).toMatchObject({
      inProgress: false,
      completedCount: 0,
    });
  });

  it("does not claim complete coverage until the agent has reported a compaction lifecycle in this thread", () => {
    sequenceByThread = new Map();
    const { db, thread } = setup();
    expect(build(db, thread)).toMatchObject({
      coverage: "partial",
      gaps: ["provider-unverified"],
      completedCount: 0,
    });
    marker(db, thread, "t1");
    expect(build(db, thread)).toMatchObject({
      coverage: "partial",
      completedCount: 1,
    });
    compactionItem(db, thread, "item/started", "t2", "c2");
    marker(db, thread, "t2", "c2");
    expect(build(db, thread)).toMatchObject({
      coverage: "complete",
      completedCount: 2,
    });
  });
});
