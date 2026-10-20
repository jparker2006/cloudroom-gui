// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@cloudroom/test-helpers";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";

const sockets = vi.hoisted(() => {
  class FakeSocket {
    onclose: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 0;
    constructor() {
      instances.push(this);
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    send() {}
  }
  const instances: FakeSocket[] = [];
  return { FakeSocket, instances };
});
vi.mock("partysocket/ws", () => ({ default: sockets.FakeSocket }));
vi.mock("@/lib/dev-websocket-url", () => ({ buildBrowserWebSocketUrl: () => "ws://bb.test/ws" }));

Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
});

const { wsManager } = await import("@/lib/ws");
const { StaleConversationMarker, useStaleConversationLabel } = await import("./ThreadConnectionStatus");

const GRACE_MS = 10_000;
let queryClient: QueryClient;

function Marker({ threadId }: { threadId: string }) {
  return <StaleConversationMarker label={useStaleConversationLabel(threadId, true)} />;
}

function view(threadId: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <Marker threadId={threadId} />
    </QueryClientProvider>
  );
}

const socket = () => sockets.instances[sockets.instances.length - 1];
const saved = () => screen.queryByText(/Saved copy from/);

function dropSocket() {
  act(() => socket().close());
}

function openSocket() {
  act(() => socket().open());
}

function elapse(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function startRead(threadId: string) {
  const read = createDeferredPromise<{ rows: never[]; maxSeq: number }>();
  let pending!: Promise<unknown>;
  act(() => {
    pending = queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(threadId), queryFn: () => read.promise, staleTime: 0 });
  });
  return {
    finish: () =>
      act(async () => {
        read.resolve({ rows: [], maxSeq: 9 });
        await pending;
      }),
  };
}

function freshRead(threadId: string) {
  return act(async () => {
    await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey(threadId), queryFn: () => ({ rows: [], maxSeq: 50 }), staleTime: 0 });
  });
}

function holdThroughLongOutage(threadId: string) {
  const rendered = render(view(threadId));
  dropSocket();
  elapse(GRACE_MS + 1);
  expect(saved()).toBeTruthy();
  openSocket();
  expect(saved()).toBeTruthy();
  return rendered;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 20, 14, 14) });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (sockets.instances.length === 0) wsManager.connect();
  if (socket().readyState !== 1) openSocket();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("N1: a read started before a later sub-grace flap does not release the saved copy when it finishes after that reconnect", async () => {
  const thread = "thr_n1";
  queryClient.setQueryData(threadTimelineQueryKey(thread), { rows: [], maxSeq: 1 });
  holdThroughLongOutage(thread);

  const read = startRead(thread);
  dropSocket();
  elapse(2_000);
  openSocket();
  await read.finish();
  expect(saved()).toBeTruthy();

  await freshRead(thread);
  expect(saved()).toBeNull();
});

it("N1b: a surviving read started before an outage that happened while the marker was unmounted does not release it", async () => {
  const thread = "thr_n1b";
  queryClient.setQueryData(threadTimelineQueryKey(thread), { rows: [], maxSeq: 1 });
  const rendered = holdThroughLongOutage(thread);

  const read = startRead(thread);
  rendered.unmount();
  dropSocket();
  elapse(GRACE_MS + 1);
  openSocket();
  await read.finish();

  render(view(thread));
  expect(saved()).toBeTruthy();
});

it("control: a read started after the latest reconnect still releases the saved copy", async () => {
  const thread = "thr_n1_control";
  queryClient.setQueryData(threadTimelineQueryKey(thread), { rows: [], maxSeq: 1 });
  holdThroughLongOutage(thread);
  dropSocket();
  elapse(2_000);
  openSocket();

  const read = startRead(thread);
  await read.finish();
  expect(saved()).toBeNull();
});

it("control: an ordinary short flicker with no held copy never shows a saved-copy marker", () => {
  const thread = "thr_flicker";
  queryClient.setQueryData(threadTimelineQueryKey(thread), { rows: [], maxSeq: 1 });
  render(view(thread));
  dropSocket();
  elapse(3_000);
  expect(saved()).toBeNull();
  openSocket();
  expect(saved()).toBeNull();
});
