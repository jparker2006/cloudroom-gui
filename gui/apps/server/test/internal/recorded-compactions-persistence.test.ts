import {
  deleteThreadEventSuffixInTransaction,
  getLatestThreadSequence,
  listEvents,
} from "@cloudroom/db";
import { turnScope } from "@cloudroom/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@cloudroom/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { buildRecordedCompactions } from "../../src/services/threads/recorded-compactions.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedFixture(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "claude-code",
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-session",
    threadId: thread.id,
  });
  return { host, session, thread };
}

function compactionTurnEvents(
  threadId: string,
  turnId: string,
  itemIds: string[],
): HostDaemonEventEnvelope[] {
  const base = { threadId, providerThreadId: "provider-session" };
  const scope = turnScope(turnId);
  const events: HostDaemonEventEnvelope["event"][] = [
    { ...base, scope, type: "turn/started" },
  ];
  for (const id of itemIds) {
    const item = { type: "contextCompaction" as const, id };
    events.push(
      { ...base, scope, type: "item/started", item },
      { ...base, scope, type: "thread/compacted", itemId: id },
      { ...base, scope, type: "item/completed", item },
    );
  }
  events.push({ ...base, scope, type: "turn/completed", status: "completed" });
  return events.map((event) => ({ threadId, event }));
}

async function postEvents(
  harness: TestAppHarness,
  sessionId: string,
  events: HostDaemonEventEnvelope[],
) {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(events),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

async function readContext(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/context`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    compactions: {
      revision: string;
      completedCount: number;
      entries: Array<{ kind: string; id: string; status?: string }>;
    };
  };
}

describe("recorded compactions through persistence", () => {
  it("keeps marker item ids through the daemon event route so two compactions in one turn stay distinct", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedFixture(harness);
      await postEvents(
        harness,
        session.id,
        compactionTurnEvents(thread.id, "turn-1", ["cmp-a", "cmp-b"]),
      );

      const markers = listEvents(harness.db, { threadId: thread.id })
        .filter((row) => row.type === "thread/compacted")
        .map((row) => JSON.parse(row.data) as { itemId?: string });
      expect(markers.map((marker) => marker.itemId)).toEqual([
        "cmp-a",
        "cmp-b",
      ]);

      const { compactions } = await readContext(harness, thread.id);
      expect(compactions.completedCount).toBe(2);
      expect(compactions.entries.map((entry) => entry.id)).toEqual([
        "cmp-b",
        "cmp-a",
      ]);

      const timeline = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      const body = (await timeline.json()) as {
        recordedCompactions?: { revision: string; completedCount: number };
      };
      expect(body.recordedCompactions).toMatchObject({
        revision: compactions.revision,
        completedCount: 2,
      });
    });
  });

  it("shows the real clear route as an uncounted divider", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedFixture(harness);
      const { session, thread } = fixture;
      const responder = registerHostRpcResponder(harness, {
        hostId: fixture.host.id,
        sessionId: session.id,
        handle: async ({ command }) => {
          if (command.type === "thread.stop") {
            return { ok: true, result: { providerCheckpointId: null } };
          }
          throw new Error(`Unexpected command: ${command.type}`);
        },
      });
      try {
        await postEvents(
          harness,
          session.id,
          compactionTurnEvents(thread.id, "turn-1", ["cmp-a"]),
        );
        const cleared = await harness.app.request(
          `/api/v1/threads/${thread.id}/context/clear`,
          { method: "POST" },
        );
        expect(cleared.status, await cleared.clone().text()).toBeLessThan(300);

        const { compactions } = await readContext(harness, thread.id);
        expect(compactions.completedCount).toBe(1);
        expect(compactions.entries.map((entry) => entry.kind)).toEqual([
          "clear",
          "compaction",
        ]);
      } finally {
        responder.unregister();
      }
    });
  });

  it("drops cached history when events are rewritten and picks up appended events", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedFixture(harness);
      await postEvents(
        harness,
        session.id,
        compactionTurnEvents(thread.id, "turn-1", ["cmp-a"]),
      );
      const cutoff = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      await postEvents(
        harness,
        session.id,
        compactionTurnEvents(thread.id, "turn-2", ["cmp-b"]),
      );
      const build = () =>
        buildRecordedCompactions(
          harness.db,
          thread,
          getLatestThreadSequence(harness.db, { threadId: thread.id }),
          true,
        );
      const both = build();
      expect(both.completedCount).toBe(2);
      expect(build().revision).toBe(both.revision);

      harness.db.transaction((tx) =>
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: thread.id,
          cutoffSequence: cutoff + 1,
          oldMaxSequence: getLatestThreadSequence(harness.db, {
            threadId: thread.id,
          }),
        }),
      );
      const rewound = build();
      expect(rewound.completedCount).toBe(1);
      expect(rewound.revision).not.toBe(both.revision);

      await postEvents(
        harness,
        session.id,
        compactionTurnEvents(thread.id, "turn-3", ["cmp-c"]),
      );
      expect(build()).toMatchObject({
        completedCount: 2,
        entries: [{ id: "cmp-c" }, { id: "cmp-a" }],
      });
    });
  });
});
