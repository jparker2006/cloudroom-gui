// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";

const live = vi.hoisted(() => ({ state: "reconnecting" as "connected" | "reconnecting", disconnectedAt: 0 as number | null }));
vi.mock("@/hooks/useServerConnectionState", () => ({ useServerConnectionState: () => live.state }));
vi.mock("@/hooks/queries/connection-aware-query-state", () => ({ useServerConnectionGracePeriodElapsed: () => live.state !== "connected" }));
vi.mock("@/lib/ws", () => ({ wsManager: { getDisconnectedAt: () => live.disconnectedAt, getConnectionState: () => live.state, reconnectNow: vi.fn() } }));

const { StaleConversationMarker: Marker, useStaleConversationLabel } = await import("./ThreadConnectionStatus");

function StaleConversationMarker({ threadId, hasRows }: { threadId: string; hasRows: boolean }) {
  return <Marker label={useStaleConversationLabel(threadId, hasRows)} />;
}

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

it("keeps the saved-copy marker after reconnecting until the conversation is actually refreshed", async () => {
  const view = render(marker());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();

  live.state = "connected";
  live.disconnectedAt = null;
  view.rerender(marker());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();

  await act(async () => {
    await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey("thr_1"), queryFn: () => ({ rows: [], maxSeq: 2 }), staleTime: 0 });
  });
  expect(screen.queryByText(/Saved copy/)).toBeNull();
});

describe("after reconnecting, before an authoritative refetch succeeds (R5)", () => {
  function reconnect(view: ReturnType<typeof render>) {
    live.state = "connected";
    live.disconnectedAt = null;
    view.rerender(marker());
  }

  it("keeps the marker through a local cache write", () => {
    const view = render(marker());
    reconnect(view);
    act(() => {
      queryClient.setQueryData(threadTimelineQueryKey("thr_1"), { rows: [], maxSeq: 1 });
    });
    expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();
  });

  it("keeps the marker when the refetch fails, and releases it only when a fetch succeeds", async () => {
    const view = render(marker());
    reconnect(view);
    await act(async () => {
      await queryClient
        .fetchQuery({ queryKey: threadTimelineQueryKey("thr_1"), queryFn: () => Promise.reject(new TypeError("Failed to fetch")), retry: false })
        .catch(() => undefined);
    });
    expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey("thr_1"), queryFn: () => ({ rows: [], maxSeq: 3 }), staleTime: 0 });
    });
    expect(screen.queryByText(/Saved copy/)).toBeNull();
  });

  it("still shows the marker after switching away and back while the refresh is unconfirmed", () => {
    const view = render(marker());
    reconnect(view);
    view.unmount();
    render(marker());
    expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();
  });
});
