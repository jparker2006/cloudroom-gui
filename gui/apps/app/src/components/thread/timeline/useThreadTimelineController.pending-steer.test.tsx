// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
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

function renderHandoff(queryClient: ReturnType<typeof makeQueryClient>) {
  const hook = renderHook(
    ({ queue, threadId }) => usePendingSteerHandoff(threadId, queue),
    { initialProps: { queue: cachedQueue(queryClient), threadId: "thread-1" } },
  );
  const view = () => {
    hook.rerender({ queue: cachedQueue(queryClient), threadId: "thread-1" });
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
      .filter((message) => !isPendingSteerQueuedMessage(message))
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

  it("lets a departed steer go after the handoff window when no timeline row arrives", () => {
    vi.useFakeTimers();
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { view } = renderHandoff(queryClient);

    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), []);
    expect(view()).toEqual(PENDING_VIEW);

    act(() => vi.advanceTimersByTime(4_999));
    expect(view()).toEqual(PENDING_VIEW);
    act(() => vi.advanceTimersByTime(1));
    expect(view()).toEqual({ strip: [], timeline: ["first|accepted"] });
  });

  it("does not carry a departing steer into another thread", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(threadQueuedMessagesQueryKey("thread-1"), [
      turnStartingSteer(),
    ]);
    const { hook } = renderHandoff(queryClient);
    expect(hook.result.current.map((message) => message.id)).toEqual([
      "qmsg-steer",
    ]);

    hook.rerender({ queue: [], threadId: "thread-1" });
    expect(hook.result.current.map((message) => message.id)).toEqual([
      "qmsg-steer",
    ]);
    hook.rerender({ queue: [], threadId: "thread-2" });
    expect(hook.result.current).toEqual([]);
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
