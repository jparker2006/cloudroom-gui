// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import type { ThreadTimelineResponse, TimelineRow } from "@cloudroom/server-contract";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
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
const clearDraftIfMatches = vi.fn();

function record(overrides: Partial<Omit<DeliveryAttempt, "key">> = {}) {
  recordDeliveryAttempt({
    threadId: "thr_1",
    phase: "checking",
    draft: DRAFT,
    text: TEXT,
    attachmentCount: 1,
    baselineMaxSeq: 10,
    baselineQueueIds: [],
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
  queryClient.setQueryDefaults(threadQueuedMessagesQueryKey("thr_1"), { queryFn: () => serverQueue });
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

  it("confirms delivery after reconnecting and clears only the matching restored draft", async () => {
    const resend = vi.fn();
    record({ resend });
    const view = renderCard();
    expect(screen.getByText("Delivery unconfirmed")).toBeTruthy();
    serverRows = [...serverRows, userRow(11, TEXT)];
    connection.state = "connected";
    view.rerender(card());
    await waitFor(() => expect(screen.getByText("Delivered")).toBeTruthy());
    expect(clearDraftIfMatches).toHaveBeenCalledWith(DRAFT);
    expect(resend).not.toHaveBeenCalled();
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

  it("says not sent only for the offline-before-send case and keeps the draft", () => {
    record({ phase: "not-sent" });
    renderCard();
    expect(screen.getByText("Not sent")).toBeTruthy();
    expect(screen.getByText(/never left this device/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
  });
});
