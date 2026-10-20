// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";

const live = vi.hoisted(() => ({ state: "reconnecting" as "connected" | "reconnecting", disconnectedAt: 0 as number | null }));
vi.mock("@/hooks/useServerConnectionState", () => ({ useServerConnectionState: () => live.state }));
vi.mock("@/hooks/queries/connection-aware-query-state", () => ({ useServerConnectionGracePeriodElapsed: () => live.state !== "connected" }));
vi.mock("@/lib/ws", () => ({ wsManager: { getDisconnectedAt: () => live.disconnectedAt, reconnectNow: vi.fn() } }));

const { StaleConversationMarker } = await import("./ThreadConnectionStatus");

let queryClient: QueryClient;

function marker() {
  return (
    <QueryClientProvider client={queryClient}>
      <StaleConversationMarker threadId="thr_1" hasRows />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 20, 14, 20) });
  queryClient = new QueryClient();
  live.state = "reconnecting";
  live.disconnectedAt = new Date(2026, 9, 20, 14, 14).getTime();
  queryClient.setQueryData(threadTimelineQueryKey("thr_1"), { rows: [], maxSeq: 1 }, { updatedAt: new Date(2026, 9, 20, 14, 10).getTime() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps the saved-copy marker after reconnecting until the conversation is actually refreshed", () => {
  const view = render(marker());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();

  live.state = "connected";
  live.disconnectedAt = null;
  view.rerender(marker());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();

  act(() => {
    queryClient.setQueryData(threadTimelineQueryKey("thr_1"), { rows: [], maxSeq: 2 });
  });
  expect(screen.queryByText(/Saved copy/)).toBeNull();
});
