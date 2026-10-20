// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Thread, ThreadQueuedMessage } from "@cloudroom/domain";
import type {
  ThreadQueuedMessageListResponse,
  ThreadTimelineResponse,
  TimelineRow,
} from "@cloudroom/server-contract";
import { makeThreadQueuedMessage } from "@cloudroom/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySendThreadMessageSuccess,
  beginSendThreadMessageTransaction,
  rollbackSendThreadMessageTransaction,
} from "@/hooks/cache-owners/thread-runtime-cache-owner";
import {
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { isPendingSteerQueuedMessage } from "@/lib/queued-message-wait";
import { createAppQueryClient } from "@/lib/query-client";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import {
  appendPendingSteerRows,
  usePendingSteerHandoff,
} from "./useThreadTimelineController";

const STEER_TEXT = "also check the tests";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeQueryClient() {
  const queryClient = createAppQueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    showMutationErrorToasts: false,
  });
  queryClient.setQueryData(threadQueryKey("thread-1"), {
    id: "thread-1",
    status: "active",
    updatedAt: 1,
    runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
  });
  queryClient.setQueryData(
    threadTimelineQueryKey("thread-1"),
    makeThreadTimelineResponse({ rows: [userRow("first", "turn-1", 1)] }),
  );
  queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
  return queryClient;
}

function userRow(text: string, id: string, createdAt: number): TimelineRow {
  return conversationRow({
    createdAt,
    id,
    role: "user",
    seq: createdAt,
    text,
    threadId: "thread-1",
    turnId: id,
    turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
  });
}

function turnStartingSteer(
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return makeThreadQueuedMessage({
    id: "qmsg-steer",
    threadId: "thread-1",
    content: [{ type: "text", text: STEER_TEXT, mentions: [] }],
    waitingOn: { kind: "turn-starting" },
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  });
}

const steerRequest = {
  id: "thread-1",
  mode: "steer-if-active" as const,
  input: [{ type: "text" as const, text: STEER_TEXT, mentions: [] }],
};

function cachedQueue(
  queryClient: ReturnType<typeof makeQueryClient>,
): ThreadQueuedMessageListResponse | undefined {
  return queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1"));
}

function cachedThreadStatus(
  queryClient: ReturnType<typeof makeQueryClient>,
): Thread["status"] | undefined {
  return queryClient.getQueryData<{ status: Thread["status"] }>(
    threadQueryKey("thread-1"),
  )?.status;
}

function setThreadStatus(
  queryClient: ReturnType<typeof makeQueryClient>,
  status: Thread["status"],
) {
  queryClient.setQueryData(threadQueryKey("thread-1"), {
    id: "thread-1",
    status,
    updatedAt: 2,
    runtime: { displayStatus: status, hostReconnectGraceExpiresAt: null },
  });
}

function renderHandoff(queryClient: ReturnType<typeof makeQueryClient>) {
  const props = () => ({
    queue: cachedQueue(queryClient),
    status: cachedThreadStatus(queryClient),
    threadId: "thread-1",
  });
  const hook = renderHook(
    ({ queue, status, threadId }) =>
      usePendingSteerHandoff(threadId, status, queue),
    { initialProps: props() },
  );
  const view = () => {
    hook.rerender(props());
    const timeline = appendPendingSteerRows(
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey("thread-1"),
      )?.rows ?? [],
      hook.result.current,
    ).flatMap((row) =>
      row.kind === "conversation" && row.role === "user"
        ? [`${row.text}|${row.turnRequest.status}`]
        : [],
    );
    const strip = (cachedQueue(queryClient) ?? [])
      .filter(
        (message) =>
          !isPendingSteerQueuedMessage(message, cachedThreadStatus(queryClient)),
      )
      .map((message) => message.id);
    return { strip, timeline };
  };
  return { hook, view };
}

function setServerTimeline(
  queryClient: ReturnType<typeof makeQueryClient>,
  rows: TimelineRow[],
) {
  queryClient.setQueryData(
    threadTimelineQueryKey("thread-1"),
    makeThreadTimelineResponse({ rows }),
  );
}

const PENDING_VIEW = {
  strip: [],
  timeline: ["first|accepted", `${STEER_TEXT}|pending`],
};
const ACCEPTED_VIEW = {
  strip: [],
  timeline: ["first|accepted", `${STEER_TEXT}|accepted`],
};

describe("steer queued until the turn starts", () => {
  it("stays in the timeline when realtime lands before the response, then hands off on admission", async () => {
    const queryClient = makeQueryClient();
    const { view } = renderHandoff(queryClient);
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: steerRequest,
    });
    expect(view()).toEqual(PENDING_VIEW);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    expect(view()).toEqual(PENDING_VIEW);

    applySendThreadMessageSuccess({
      queryClient,
      realtimeConnected: true,
      request: steerRequest,
      result: { ok: true, delivery: "queued", queuedMessage: turnStartingSteer() },
      transaction,
    });
    expect(view()).toEqual(PENDING_VIEW);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
    expect(view()).toEqual(PENDING_VIEW);

    setServerTimeline(queryClient, [
      userRow("first", "turn-1", 1),
      userRow(STEER_TEXT, "steer-row", 12),
    ]);
    expect(view()).toEqual(ACCEPTED_VIEW);
  });

  it("stays in the timeline when the response lands first and the timeline refetch beats the queue refetch", async () => {
    const queryClient = makeQueryClient();
    const { view } = renderHandoff(queryClient);
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: steerRequest,
    });

    applySendThreadMessageSuccess({
      queryClient,
      realtimeConnected: true,
      request: steerRequest,
      result: { ok: true, delivery: "queued", queuedMessage: turnStartingSteer() },
      transaction,
    });
    expect(view()).toEqual(PENDING_VIEW);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ updatedAt: 11 }),
    ]);
    expect(view()).toEqual(PENDING_VIEW);

    setServerTimeline(queryClient, [
      userRow("first", "turn-1", 1),
      userRow(STEER_TEXT, "steer-row", 12),
    ]);
    expect(view()).toEqual(ACCEPTED_VIEW);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
    expect(view()).toEqual(ACCEPTED_VIEW);
  });

  it("shows a turn-starting steer found after a reconnect as pending in the timeline", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { view } = renderHandoff(queryClient);

    expect(view()).toEqual(PENDING_VIEW);
  });

  it("drops the optimistic steer and keeps the queue untouched when the send fails", async () => {
    const queryClient = makeQueryClient();
    const { view } = renderHandoff(queryClient);
    const transaction = await beginSendThreadMessageTransaction({
      queryClient,
      request: steerRequest,
    });
    expect(view()).toEqual(PENDING_VIEW);

    rollbackSendThreadMessageTransaction({
      queryClient,
      request: steerRequest,
      transaction,
    });
    expect(view()).toEqual({ strip: [], timeline: ["first|accepted"] });
  });

  it("keeps failed and still-queued rows in the strip where they can be recovered", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ id: "qmsg-failed", failureReason: "Steer failed" }),
      turnStartingSteer({ id: "qmsg-busy", waitingOn: { kind: "thread-busy" } }),
      turnStartingSteer({ id: "qmsg-agent", initiator: "agent" }),
    ]);
    const { view } = renderHandoff(queryClient);

    expect(view()).toEqual({
      strip: ["qmsg-failed", "qmsg-busy", "qmsg-agent"],
      timeline: ["first|accepted"],
    });
  });

  it("moves a steer to the strip when its turn ends before it could join", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { view } = renderHandoff(queryClient);
    expect(view()).toEqual(PENDING_VIEW);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ waitingOn: { kind: "thread-busy" } }),
    ]);
    expect(view()).toEqual({ strip: ["qmsg-steer"], timeline: ["first|accepted"] });
  });

  it("keeps rapid identical steers apart while only one has been admitted", () => {
    const queryClient = makeQueryClient();
    setServerTimeline(queryClient, [
      userRow("first", "turn-1", 1),
      userRow(STEER_TEXT, "older-steer", 2),
    ]);
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ id: "qmsg-a", createdAt: 10 }),
      turnStartingSteer({ id: "qmsg-b", createdAt: 11 }),
    ]);
    const { view } = renderHandoff(queryClient);
    expect(view().timeline).toEqual([
      "first|accepted",
      `${STEER_TEXT}|accepted`,
      `${STEER_TEXT}|pending`,
      `${STEER_TEXT}|pending`,
    ]);

    setServerTimeline(queryClient, [
      userRow("first", "turn-1", 1),
      userRow(STEER_TEXT, "older-steer", 2),
      userRow(STEER_TEXT, "steer-a", 12),
    ]);
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ id: "qmsg-b", createdAt: 11 }),
    ]);
    expect(view().timeline).toEqual([
      "first|accepted",
      `${STEER_TEXT}|accepted`,
      `${STEER_TEXT}|accepted`,
      `${STEER_TEXT}|pending`,
    ]);
  });

  it("hands off a multi-part steer whose server row joins its text parts differently", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({
        content: [
          { type: "text", text: "also check", mentions: [] },
          { type: "text", text: " the tests", mentions: [] },
        ],
      }),
    ]);
    const { view } = renderHandoff(queryClient);
    expect(view().timeline).toEqual([
      "first|accepted",
      "also check\n\n the tests|pending",
    ]);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
    setServerTimeline(queryClient, [
      userRow("first", "turn-1", 1),
      userRow("also check the tests", "steer-row", 12),
    ]);
    expect(view().timeline).toEqual([
      "first|accepted",
      "also check the tests|accepted",
    ]);
  });

  it("lets each departed steer go five seconds after it left when no timeline row arrives", () => {
    vi.useFakeTimers();
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({ id: "qmsg-a", createdAt: 10 }),
      turnStartingSteer({
        id: "qmsg-b",
        createdAt: 11,
        content: [{ type: "text", text: "second steer", mentions: [] }],
      }),
    ]);
    const { view } = renderHandoff(queryClient);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer({
        id: "qmsg-b",
        createdAt: 11,
        content: [{ type: "text", text: "second steer", mentions: [] }],
      }),
    ]);
    expect(view().timeline).toHaveLength(3);
    act(() => vi.advanceTimersByTime(1_500));
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
    expect(view().timeline).toHaveLength(3);

    act(() => vi.advanceTimersByTime(3_499));
    expect(view().timeline).toHaveLength(3);
    act(() => vi.advanceTimersByTime(1));
    expect(view().timeline).toEqual(["first|accepted", "second steer|pending"]);
    act(() => vi.advanceTimersByTime(1_500));
    expect(view()).toEqual({ strip: [], timeline: ["first|accepted"] });
  });

  it("keeps an unfinished handoff across a switch to another thread and back", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { hook } = renderHandoff(queryClient);
    const ids = () => hook.result.current.map((message) => message.id);

    hook.rerender({ queue: [], status: "active", threadId: "thread-1" });
    expect(ids()).toEqual(["qmsg-steer"]);
    hook.rerender({ queue: [], status: "active", threadId: "thread-2" });
    expect(ids()).toEqual([]);
    hook.rerender({ queue: [], status: "active", threadId: "thread-1" });
    expect(ids()).toEqual(["qmsg-steer"]);
  });

  it("keeps a steer that left the queue while the user was on another thread", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { hook } = renderHandoff(queryClient);
    const ids = () => hook.result.current.map((message) => message.id);

    hook.rerender({ queue: [], status: "active", threadId: "thread-2" });
    expect(ids()).toEqual([]);
    hook.rerender({ queue: [], status: "active", threadId: "thread-1" });
    expect(ids()).toEqual(["qmsg-steer"]);
  });

  it("does not treat messages that differ only in spacing as the same steer", () => {
    const rows = appendPendingSteerRows(
      [
        userRow("first", "turn-1", 1),
        userRow("use foobar", "other-row", 12),
      ],
      [
        turnStartingSteer({
          content: [{ type: "text", text: "use foo bar", mentions: [] }],
        }),
      ],
    );
    expect(
      rows.flatMap((row) =>
        row.kind === "conversation" && row.role === "user" ? [row.text] : [],
      ),
    ).toEqual(["first", "use foobar", "use foo bar"]);
  });

  it("returns a steer to the strip when the thread stops before its turn starts", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { view } = renderHandoff(queryClient);
    expect(view()).toEqual(PENDING_VIEW);

    setThreadStatus(queryClient, "idle");
    expect(view()).toEqual({ strip: ["qmsg-steer"], timeline: ["first|accepted"] });
  });

  it("keeps attachment-only steers apart from each other", () => {
    const fileSteer = (id: string, path: string, createdAt: number) =>
      turnStartingSteer({
        id,
        createdAt,
        content: [{ type: "localFile", path }],
      });
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      fileSteer("qmsg-a", "/tmp/a.txt", 10),
      fileSteer("qmsg-b", "/tmp/b.txt", 11),
    ]);
    const { hook } = renderHandoff(queryClient);
    hook.rerender({
      queue: cachedQueue(queryClient),
      status: "active",
      threadId: "thread-1",
    });
    const rows = appendPendingSteerRows(
      [
        userRow("first", "turn-1", 1),
        {
          ...userRow("", "steer-b", 12),
          attachments: {
            webImages: 0,
            localImages: 0,
            localFiles: 1,
            imageUrls: [],
            localImagePaths: [],
            localFilePaths: ["/tmp/b.txt"],
          },
        } as TimelineRow,
      ],
      hook.result.current,
    );
    expect(
      rows.flatMap((row) =>
        row.kind === "conversation" && row.role === "user"
          ? [row.attachments?.localFilePaths ?? []]
          : [],
      ),
    ).toEqual([[], ["/tmp/b.txt"], ["/tmp/a.txt"]]);
  });

  it("clears only the submitted draft and never restores over newer typing", () => {
    const scope = {
      kind: "thread" as const,
      projectId: "proj-steer",
      threadId: "thread-1",
    };
    const { result } = renderHook(() => usePromptDraftStorage(scope));
    act(() => result.current.setTextAndMentions(STEER_TEXT, []));
    const submitted = result.current.getCurrent();

    act(() => {
      expect(result.current.clearIfCurrentMatches(submitted)).toBe(true);
    });
    expect(result.current.text).toBe("");

    act(() => result.current.setTextAndMentions("next message", []));
    act(() => result.current.restoreIfEmpty(submitted));
    expect(result.current.text).toBe("next message");
  });
});
