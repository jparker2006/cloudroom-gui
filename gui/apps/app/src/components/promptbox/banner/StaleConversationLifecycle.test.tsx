// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@cloudroom/test-helpers";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";

const live = vi.hoisted(() => ({
  state: "reconnecting" as "connected" | "reconnecting",
  disconnectedAt: 0 as number | null,
}));
vi.mock("@/hooks/useServerConnectionState", () => ({ useServerConnectionState: () => live.state }));
vi.mock("@/hooks/queries/connection-aware-query-state", () => ({
  useServerConnectionGracePeriodElapsed: () => live.state !== "connected",
}));
vi.mock("@/lib/ws", () => ({
  wsManager: {
    getDisconnectedAt: () => live.disconnectedAt,
    getConnectionState: () => live.state, onConnectionStateChange: () => () => {},
    reconnectNow: vi.fn(),
  },
}));

const { StaleConversationMarker, useStaleConversationLabel } = await import("./ThreadConnectionStatus");

const DISCONNECTED_AT = new Date(2026, 9, 20, 14, 14).getTime();
let queryClient: QueryClient;
let serverReads: number;

function Marker({ threadId }: { threadId: string }) {
  return <StaleConversationMarker label={useStaleConversationLabel(threadId, true)} />;
}

function ActiveTimeline({ threadId }: { threadId: string }) {
  useQuery({
    queryKey: threadTimelineQueryKey(threadId),
    queryFn: async () => {
      serverReads += 1;
      return { rows: [], maxSeq: 100 + serverReads };
    },
    staleTime: Infinity,
  });
  return null;
}

function view(threadId: string, withActiveTimeline = false) {
  return (
    <QueryClientProvider client={queryClient}>
      {withActiveTimeline ? <ActiveTimeline threadId={threadId} /> : null}
      <Marker threadId={threadId} />
    </QueryClientProvider>
  );
}

function seed(threadId: string) {
  queryClient.setQueryData(threadTimelineQueryKey(threadId), { rows: [], maxSeq: 1 }, { updatedAt: DISCONNECTED_AT - 60_000 });
}

function disconnect(rendered: ReturnType<typeof render>, element: React.ReactElement) {
  live.state = "reconnecting";
  live.disconnectedAt = DISCONNECTED_AT;
  rendered.rerender(element);
}

function reconnect(rendered: ReturnType<typeof render>, element: React.ReactElement) {
  live.state = "connected";
  live.disconnectedAt = null;
  rendered.rerender(element);
}

function freshFetch(threadId: string) {
  return act(async () => {
    await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(threadId), queryFn: () => ({ rows: [], maxSeq: 50 }), staleTime: 0 });
  });
}

const saved = () => screen.queryByText(/Saved copy from 2:14/);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  serverReads = 0;
  live.state = "connected";
  live.disconnectedAt = null;
});

afterEach(() => {
  cleanup();
});

it("F1: a timeline fetch that began before reconnect does not release the saved-copy marker; a fresh one does", async () => {
  const thread = "thr_f1";
  seed(thread);
  const rendered = render(view(thread));
  disconnect(rendered, view(thread));
  expect(saved()).toBeTruthy();

  const inFlight = createDeferredPromise<{ rows: never[]; maxSeq: number }>();
  let pending!: Promise<unknown>;
  act(() => {
    pending = queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(thread), queryFn: () => inFlight.promise, staleTime: 0 });
  });

  reconnect(rendered, view(thread));
  await act(async () => {
    inFlight.resolve({ rows: [], maxSeq: 2 });
    await pending;
  });
  expect(saved()).toBeTruthy();

  await freshFetch(thread);
  expect(saved()).toBeNull();
});

it("F2: after a manual timeline write during the outage, reconnecting still obtains an authoritative read and then releases", async () => {
  const thread = "thr_f2";
  seed(thread);
  const rendered = render(view(thread, true));
  disconnect(rendered, view(thread, true));
  act(() => {
    queryClient.setQueryData(threadTimelineQueryKey(thread), { rows: [], maxSeq: 1 });
  });
  const readsBeforeReconnect = serverReads;

  reconnect(rendered, view(thread, true));
  expect(saved()).toBeTruthy();
  await waitFor(() => expect(serverReads).toBeGreaterThan(readsBeforeReconnect));
  await waitFor(() => expect(saved()).toBeNull());
});

it("F12: a successful fresh read while the marker is unmounted is honoured on remount", async () => {
  const thread = "thr_f12";
  seed(thread);
  const rendered = render(view(thread));
  disconnect(rendered, view(thread));
  reconnect(rendered, view(thread));
  expect(saved()).toBeTruthy();
  rendered.unmount();

  await freshFetch(thread);

  render(view(thread));
  expect(saved()).toBeNull();
});

it("F13: a retained instance switched to another thread does not show the first thread's saved copy", () => {
  const first = "thr_f13_a";
  const second = "thr_f13_b";
  seed(first);
  seed(second);
  const rendered = render(view(first));
  disconnect(rendered, view(first));
  reconnect(rendered, view(first));
  expect(saved()).toBeTruthy();

  rendered.rerender(view(second));
  expect(saved()).toBeNull();
});

it("repeated reconnects: a read that began in a short connected window but finished in the next outage does not release", async () => {
  const thread = "thr_repeat";
  seed(thread);
  const rendered = render(view(thread));
  disconnect(rendered, view(thread));
  reconnect(rendered, view(thread));

  const between = createDeferredPromise<{ rows: never[]; maxSeq: number }>();
  let pending!: Promise<unknown>;
  act(() => {
    pending = queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(thread), queryFn: () => between.promise, staleTime: 0 });
  });
  disconnect(rendered, view(thread));
  await act(async () => {
    between.resolve({ rows: [], maxSeq: 3 });
    await pending;
  });
  reconnect(rendered, view(thread));
  expect(saved()).toBeTruthy();

  await freshFetch(thread);
  expect(saved()).toBeNull();
});
