// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";

const live = vi.hoisted(() => ({ state: "connected" as "connected" | "reconnecting", grace: false, disconnectedAt: null as number | null }));
vi.mock("@/hooks/queries/system-queries", () => ({ useSystemConfig: () => ({ data: undefined }) }));
vi.mock("@/hooks/useServerConnectionState", () => ({ useServerConnectionState: () => live.state }));
vi.mock("@/hooks/queries/connection-aware-query-state", () => ({ useServerConnectionGracePeriodElapsed: () => live.grace }));
vi.mock("@/lib/ws", () => ({ wsManager: { getDisconnectedAt: () => live.disconnectedAt, getConnectionState: () => live.state, onConnectionStateChange: () => () => {}, reconnectNow: vi.fn() } }));

const { ThreadTimelineSurface } = await import("./ThreadTimelineSurface");

const THREAD = "thr_streaming";
let queryClient: QueryClient;

function surface() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
      <ThreadTimelineSurface
        activeThinking={null}
        contextBoundarySeq={null}
        isThreadTimelinePending={false}
        showOngoingIndicator
        ongoingIndicatorLabel="Agent is working"
        threadId={THREAD}
        threadRuntimeDisplayStatus="active"
        timelineError={false}
        timelineRows={[conversationRow({ id: "row_1", role: "user", seq: 1, text: "Ship CSV export" })]}
        workspaceRootPath={undefined}
      />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function workingVisible(): boolean {
  let node: HTMLElement | null = screen.getByText("Agent is working");
  while (node && node.style.opacity === "") node = node.parentElement;
  return node?.style.opacity === "1";
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  queryClient = new QueryClient();
  live.state = "connected";
  live.grace = false;
  live.disconnectedAt = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("does not show live work as current from a saved copy, before or after reconnect, until a refetch succeeds", async () => {
  const view = render(surface());
  expect(workingVisible()).toBe(true);
  expect(screen.queryByText(/Saved copy/)).toBeNull();

  live.state = "reconnecting";
  live.grace = true;
  live.disconnectedAt = new Date(2026, 9, 20, 14, 14).getTime();
  view.rerender(surface());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();
  expect(workingVisible()).toBe(false);

  live.state = "connected";
  live.grace = false;
  live.disconnectedAt = null;
  view.rerender(surface());
  expect(screen.getByText(/Saved copy from 2:14/)).toBeTruthy();
  expect(workingVisible()).toBe(false);

  await act(async () => {
    await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(THREAD), queryFn: () => ({ rows: [], maxSeq: 2 }) });
  });
  expect(screen.queryByText(/Saved copy/)).toBeNull();
  expect(workingVisible()).toBe(true);
});
