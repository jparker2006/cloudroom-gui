// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import type { ThreadTimelineResponse, TimelineRow } from "@cloudroom/server-contract";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makeThreadQueuedMessage } from "@cloudroom/test-helpers/domain-fixtures";
import { createDeferredPromise } from "@cloudroom/test-helpers";
import { threadQueuedMessagesQueryKey, threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import {
  clearDeliveryAttempt,
  getDeliveryAttempt,
  recordDeliveryAttempt,
  updateDeliveryAttempt,
  type DeliveryAttempt,
} from "@/lib/send-delivery";

const connection = vi.hoisted(() => ({ state: "reconnecting" as "connected" | "reconnecting" }));
vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => connection.state,
}));
vi.mock("@/lib/ws", () => ({ wsManager: { reconnectNow: vi.fn() } }));

const { DeliveryUnconfirmedCard } = await import("./DeliveryUnconfirmedCard");

const TEXT = "Please also add a CSV header row";
const DRAFT = { text: TEXT, mentions: [], attachments: [], contexts: [] } as unknown as DeliveryAttempt["draft"];

function userRow(seq: number, text: string): TimelineRow {
  return conversationRow({ id: `row_${seq}`, role: "user", seq, text });
}

function timeline(rows: TimelineRow[], maxSeq: number): ThreadTimelineResponse {
  return { rows, maxSeq } as unknown as ThreadTimelineResponse;
}

let queryClient: QueryClient;
let serverRows: TimelineRow[];
let serverQueue: ThreadQueuedMessage[];
let queueReadFails = false;
const clearDraftIfMatches = vi.fn();

function record(overrides: Partial<Omit<DeliveryAttempt, "key">> = {}) {
  recordDeliveryAttempt({
    threadId: "thr_1",
    phase: "checking",
    draft: DRAFT,
    text: TEXT,
    attachmentCount: 1,
    requestId: null,
    dedupes: false,
    resend: vi.fn(async () => undefined),
    ...overrides,
  });
}

function currentAttempt(): DeliveryAttempt | null {
  return getDeliveryAttempt("thr_1");
}

function card() {
  return (
    <QueryClientProvider client={queryClient}>
      <DeliveryUnconfirmedCard threadId="thr_1" draftInBox clearDraftIfMatches={clearDraftIfMatches} />
    </QueryClientProvider>
  );
}

function renderCard() {
  return render(card());
}

beforeEach(() => {
  connection.state = "reconnecting";
  serverRows = [userRow(10, "earlier message")];
  serverQueue = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryDefaults(threadTimelineQueryKey("thr_1"), { queryFn: () => timeline(serverRows, 20) });
  queueReadFails = false;
  queryClient.setQueryDefaults(threadQueuedMessagesQueryKey("thr_1"), {
    queryFn: () => (queueReadFails ? Promise.reject(new TypeError("Failed to fetch")) : serverQueue),
  });
  queryClient.setQueryData(threadTimelineQueryKey("thr_1"), timeline(serverRows, 10));
  queryClient.setQueryData(threadQueuedMessagesQueryKey("thr_1"), []);
  clearDraftIfMatches.mockReset();
});

afterEach(() => {
  const attempt = currentAttempt();
  if (attempt) clearDeliveryAttempt("thr_1", attempt.key);
  cleanup();
});

describe("DeliveryUnconfirmedCard", () => {
  it("never calls an unanswered send failed, and waits for the connection before checking", () => {
    record();
    renderCard();
    expect(screen.getByRole("alert").textContent).toContain("Delivery unconfirmed");
    expect(screen.getByText(/hasn't confirmed this message/)).toBeTruthy();
    expect(screen.getByText(new RegExp(TEXT))).toBeTruthy();
    expect(screen.getByText(/\+ 1 attachment/)).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh connection" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
  });

  describe("delivery identity (R1/R2)", () => {
    async function reconcileAndExpectUnresolved() {
      connection.state = "connected";
      renderCard();
      await waitFor(() => expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy());
      expect(screen.queryByText("Delivered")).toBeNull();
      expect(clearDraftIfMatches).not.toHaveBeenCalled();
      expect(currentAttempt()?.phase).toBe("not-found");
    }

    it("does not confirm a same-text message that carries different attachments", async () => {
      serverRows = [
        ...serverRows,
        conversationRow({
          id: "row_11", role: "user", seq: 11, text: TEXT,
          attachments: { webImages: 0, localImages: 0, localFiles: 1, imageUrls: [], localImagePaths: [], localFilePaths: ["/uploads/other.csv"] },
        }),
      ];
      record();
      await reconcileAndExpectUnresolved();
    });

    it("does not confirm an old server message that the stale pre-send cache had not seen", async () => {
      serverRows = [...serverRows, userRow(15, TEXT)];
      record();
      await reconcileAndExpectUnresolved();
    });

    it("does not confirm a different queued request with the same text or a different mention", async () => {
      serverQueue = [
        makeThreadQueuedMessage({ id: "req_other", content: [{ type: "text", text: TEXT, mentions: [] }] }),
        makeThreadQueuedMessage({ id: "q_mention", content: [{ type: "text", text: TEXT, mentions: [{ start: 0, end: 6, resource: { kind: "thread", threadId: "thr_other", projectId: "proj_1", label: "Please" } }] }] }),
      ];
      record({ requestId: "req_1", dedupes: true });
      await reconcileAndExpectUnresolved();
    });

    it("confirms only from the exact queued request id and clears only the matching draft", async () => {
      serverQueue = [makeThreadQueuedMessage({ id: "req_1", content: [{ type: "text", text: "edited later", mentions: [] }] })];
      const resend = vi.fn();
      record({ requestId: "req_1", dedupes: true, resend });
      connection.state = "connected";
      renderCard();
      await waitFor(() => expect(screen.getByText(/In Cloudroom's queue/)).toBeTruthy());
      expect(clearDraftIfMatches).toHaveBeenCalledWith(DRAFT);
      expect(resend).not.toHaveBeenCalled();
    });
  });

  it("F4: describes an exact queue match as being in Cloudroom's queue, not as delivered or in the conversation", async () => {
    serverQueue = [makeThreadQueuedMessage({ id: "req_1", content: [{ type: "text", text: TEXT, mentions: [] }] })];
    record({ requestId: "req_1", dedupes: true });
    connection.state = "connected";
    renderCard();
    await waitFor(() => expect(screen.getByText(/In Cloudroom's queue/)).toBeTruthy());
    expect(screen.queryByText(/Delivered|found in the conversation/i)).toBeNull();
  });

  it("F11: after a check that could not read the server, does not keep saying it is checking", async () => {
    queueReadFails = true;
    connection.state = "connected";
    record();
    renderCard();
    await waitFor(() => expect(queryClient.getQueryState(threadQueuedMessagesQueryKey("thr_1"))?.status).toBe("error"));
    await act(async () => {});
    expect(screen.queryByText(/Checking the conversation now/)).toBeNull();
    expect(screen.getByText(/Couldn't check the conversation/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check conversation" })).toBeTruthy();
    expect(screen.queryByText(/Delivered|In Cloudroom's queue/)).toBeNull();
  });

  it("N3: during an automatic recheck after an earlier failed read, says it is checking rather than that it couldn't check", async () => {
    queueReadFails = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: threadQueuedMessagesQueryKey("thr_1"), exact: true });
    });
    expect(queryClient.getQueryState(threadQueuedMessagesQueryKey("thr_1"))?.status).toBe("error");
    const pending = createDeferredPromise<ThreadQueuedMessage[]>();
    queryClient.setQueryDefaults(threadQueuedMessagesQueryKey("thr_1"), { queryFn: () => pending.promise });
    queryClient.getQueryCache().find({ queryKey: threadQueuedMessagesQueryKey("thr_1") })?.setOptions({
      queryKey: threadQueuedMessagesQueryKey("thr_1"),
      queryFn: () => pending.promise,
    });
    connection.state = "connected";
    record();
    renderCard();
    await waitFor(() => expect(queryClient.getQueryState(threadQueuedMessagesQueryKey("thr_1"))?.fetchStatus).toBe("fetching"));
    expect(queryClient.getQueryState(threadQueuedMessagesQueryKey("thr_1"))?.status).toBe("error");
    expect(screen.getByText(/Checking the conversation now/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
    await act(async () => {
      pending.resolve([]);
    });
  });

  it("N4: a manual check that fails while the message is not found says it couldn't check", async () => {
    connection.state = "connected";
    record();
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy());
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
    queueReadFails = true;
    fireEvent.click(screen.getByRole("button", { name: "Check conversation" }));
    await waitFor(() => expect(queryClient.getQueryState(threadQueuedMessagesQueryKey("thr_1"))?.status).toBe("error"));
    await act(async () => {});
    expect(screen.getByText(/Couldn't check the conversation just now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
  });

  it("offers a manual decision when the message is not found, without resending by itself", async () => {
    const resend = vi.fn();
    connection.state = "connected";
    record({ resend });
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy());
    expect(screen.getByText(/doesn't prove it wasn't received/)).toBeTruthy();
    expect(screen.getByText(/could post it twice/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check conversation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(resend).not.toHaveBeenCalled();
    expect(clearDraftIfMatches).not.toHaveBeenCalled();
  });

  it("only promises no duplicate when the send path deduplicates", async () => {
    connection.state = "connected";
    record({ dedupes: true, requestId: "req_1" });
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy());
    expect(screen.getByText(/ignores it if the first one arrived/)).toBeTruthy();
    expect(screen.queryByText(/could post it twice/)).toBeNull();
  });

  it("sends again once per click burst and clears the card and matching draft on success", async () => {
    connection.state = "connected";
    const pending = createDeferredPromise<undefined>();
    const resend = vi.fn(() => pending.promise);
    record({ resend });
    renderCard();
    const button = await screen.findByRole("button", { name: "Send again" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(resend).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      pending.resolve(undefined);
    });
    await waitFor(() => expect(screen.queryByText("Delivery unconfirmed")).toBeNull());
    expect(clearDraftIfMatches).toHaveBeenCalledWith(DRAFT);
  });

  it("returns to unconfirmed when the second attempt also gets no answer", async () => {
    connection.state = "connected";
    const resend = vi.fn(async () => {
      connection.state = "reconnecting";
      throw new TypeError("Failed to fetch");
    });
    record({ resend });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Send again" }));
    await waitFor(() => expect(currentAttempt()?.phase).toBe("checking"));
    expect(clearDraftIfMatches).not.toHaveBeenCalled();
  });

  it("ignores late updates for a replaced attempt", () => {
    record();
    const first = currentAttempt();
    record({ text: "newer message" });
    updateDeliveryAttempt("thr_1", first?.key ?? -1, { phase: "delivered" });
    expect(currentAttempt()?.phase).toBe("checking");
    expect(currentAttempt()?.text).toBe("newer message");
  });

});
