// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import type { CloudHistory, CloudListeners } from "./cloud-api";

const relay = vi.hoisted(() => ({
  listeners: new Map<string, CloudListeners>(),
  history: [] as Array<{ threadId: string; resolve: (value: CloudHistory) => void; reject: (error: Error) => void }>,
  send: vi.fn(async () => undefined),
  reload: vi.fn(),
  network: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock("./cloud-api", () => ({
  SignedOutError: class extends Error {},
  cloudApi: {
    send: relay.send,
    stop: vi.fn(),
    threads: vi.fn(async () => []),
    history: (threadId: string) =>
      new Promise<CloudHistory>((resolve, reject) => {
        relay.history.push({ threadId, resolve, reject });
      }),
    listen: (threadId: string, _after: number, listeners: CloudListeners) => {
      relay.listeners.set(threadId, listeners);
      return () => {};
    },
  },
}));
vi.mock("./cloud-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cloud-mode")>()),
  reloadApp: relay.reload,
}));
vi.mock("@/components/ui/app-toast", () => ({ appToast: { message: vi.fn() } }));
vi.mock("@/lib/ws", () => ({
  wsManager: {
    runWithoutSocket: vi.fn(),
    handleIncomingMessage: vi.fn(),
    getConnectionState: () => "connected",
    onConnectionStateChange: () => () => {},
    getDisconnectedAt: () => null,
    reconnectNow: vi.fn(),
  },
}));

const { installCloudServer } = await import("./cloud-server");
const { ThreadConnectionStatus, StaleConversationMarker, useStaleConversationLabel } = await import(
  "@/components/promptbox/banner/ThreadConnectionStatus"
);
const { recordDeliveryAttempt, getDeliveryAttempt, resetDeliveryAttemptsForTest } = await import("@/lib/send-delivery");

const versionBody = {
  currentVersion: "1.2.3",
  latestVersion: null,
  source: "npm",
  updateAvailable: false,
  isDevelopment: false,
  upgradeCommand: "npm i -g bb",
};
const probe = {
  offline: () => new Response("cloudroom: this Mac is offline", { status: 503, headers: { "x-bb-tunnel-offline": "1" } }),
  reachable: () => new Response(JSON.stringify(versionBody), { status: 200, headers: { "content-type": "application/json" } }),
  errorPage: () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
  otherPage: () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
};

let visibility: DocumentVisibilityState = "visible";
let queryClient: QueryClient;
const originalFetch = window.fetch;

function respondToVersionProbe(make: () => Response | Promise<Response>) {
  relay.network.mockImplementation(async (request: Request) => {
    if (new URL(request.url).pathname === "/api/v1/system/version") return make();
    return new Response("{}", { status: 200 });
  });
}

function sendTextThroughShim(threadId: string) {
  return window.fetch(`${window.location.origin}/api/v1/threads/${threadId}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: [{ type: "text", text: "hello", mentions: [] }] }),
  });
}

function showPage() {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function Marker({ threadId }: { threadId: string }) {
  return <StaleConversationMarker label={useStaleConversationLabel(threadId, true)} />;
}

function markers(threadIds: string[]) {
  return (
    <QueryClientProvider client={queryClient}>
      {threadIds.map((threadId) => (
        <div key={threadId} data-testid={threadId}>
          <Marker threadId={threadId} />
        </div>
      ))}
    </QueryClientProvider>
  );
}

const relayStatus = () => screen.getByRole("region", { name: "Connection status" }).textContent ?? "";
const savedIn = (threadId: string) => screen.getByTestId(threadId).textContent?.includes("Saved copy") ?? false;

function pendingHistory(threadId: string) {
  const entry = relay.history.filter((item) => item.threadId === threadId).at(-1);
  if (!entry) throw new Error(`no pending history read for ${threadId}`);
  return entry;
}

async function finishHistory(threadId: string) {
  await act(async () => {
    pendingHistory(threadId).resolve({ records: [], truncated: false, awake: false });
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function openThread(threadId: string) {
  await act(async () => {
    await sendTextThroughShim(threadId);
  });
  act(() => relay.listeners.get(threadId)?.open());
}

beforeAll(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  const NodeRequest = globalThis.Request;
  class BrowserRequest extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" && input.startsWith("/") ? new URL(input, window.location.origin) : input, init);
    }
  }
  globalThis.Request = BrowserRequest as typeof Request;
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 20, 14, 14), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  queryClient = new QueryClient();
  relay.listeners.clear();
  relay.history.length = 0;
  respondToVersionProbe(probe.offline);
  window.fetch = relay.network as unknown as typeof fetch;
  installCloudServer();
});

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
  resetDeliveryAttemptsForTest();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function relayRow() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThreadConnectionStatus cloud={null} />
    </QueryClientProvider>,
  );
}

function holdUnresolvedAttemptAndNewerDraft() {
  recordDeliveryAttempt({
    threadId: "thr_attempt",
    phase: "checking",
    draft: { text: "first", mentions: [], attachments: [{ type: "localFile", path: "uploads/a.csv", name: "a.csv" }] } as never,
    text: "first",
    attachmentCount: 1,
    requestId: null,
    dedupes: false,
    resend: vi.fn(),
  });
  localStorage.setItem("bb.promptbox.contents-proj_1-thr_attempt-3", JSON.stringify({ text: "newer draft" }));
}

for (const [name, make] of [
  ["a rejected request", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["a timeout", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))],
  ["an error page", probe.errorPage],
  ["an unrelated 200 page", probe.otherPage],
] as const) {
  it(`D1: Check again with ${name} does not reload and keeps the unresolved attempt and newer draft`, async () => {
    holdUnresolvedAttemptAndNewerDraft();
    relayRow();
    expect(relayStatus()).toContain("Can't reach your Mac");
    respondToVersionProbe(make);

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await settle();

    expect(relay.reload).not.toHaveBeenCalled();
    expect(getDeliveryAttempt("thr_attempt")?.attachmentCount).toBe(1);
    expect(localStorage.getItem("bb.promptbox.contents-proj_1-thr_attempt-3")).toContain("newer draft");
    expect(relay.send).not.toHaveBeenCalled();
    expect(relayStatus()).toContain("Can't reach your Mac");
  });
}

it("D1: refocus with an inconclusive probe does not treat it as the Mac coming back", async () => {
  holdUnresolvedAttemptAndNewerDraft();
  respondToVersionProbe(() => Promise.reject(new TypeError("Failed to fetch")));
  act(() => showPage());
  await settle();
  expect(relay.reload).not.toHaveBeenCalled();
  expect(getDeliveryAttempt("thr_attempt")).not.toBeNull();
});

it("D1 control: an explicit tunnel-offline probe keeps the relay row and does not reload", async () => {
  relayRow();
  respondToVersionProbe(probe.offline);
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await settle();
  expect(relay.reload).not.toHaveBeenCalled();
  expect(relayStatus()).toContain("Can't reach your Mac");
});

it("D1 control: a genuine Mac version answer on Check again reports reachability without navigating or clearing attempts", async () => {
  holdUnresolvedAttemptAndNewerDraft();
  relayRow();
  respondToVersionProbe(probe.reachable);
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await settle();
  expect(relay.reload).not.toHaveBeenCalled();
  expect(relayStatus()).toContain("Your Mac answered");
  expect(getDeliveryAttempt("thr_attempt")).not.toBeNull();
});

it("D1 control: refocus keeps its existing reload only for a genuine Mac version answer", async () => {
  respondToVersionProbe(probe.reachable);
  act(() => showPage());
  await settle();
  expect(relay.reload).toHaveBeenCalled();
});

it("D2: a lost relay feed marks that thread's cached conversation as a saved copy after the grace period", async () => {
  await openThread("thr_d1a");
  await openThread("thr_d1b");
  render(markers(["thr_d1a", "thr_d1b"]));
  expect(savedIn("thr_d1a")).toBe(false);

  act(() => relay.listeners.get("thr_d1a")?.error());
  act(() => {
    vi.advanceTimersByTime(10_001);
  });

  expect(savedIn("thr_d1a")).toBe(true);
  expect(savedIn("thr_d1b")).toBe(false);
});

it("D2: reopening the feed alone does not clear the saved copy; a history read started after it does", async () => {
  await openThread("thr_d2a");
  render(markers(["thr_d2a"]));
  act(() => relay.listeners.get("thr_d2a")?.error());
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  expect(savedIn("thr_d2a")).toBe(true);

  act(() => relay.listeners.get("thr_d2a")?.open());
  expect(savedIn("thr_d2a")).toBe(true);
  await finishHistory("thr_d2a");
  expect(savedIn("thr_d2a")).toBe(false);
});

it("D2: a history read that started before a newer feed loss does not clear the saved copy", async () => {
  await openThread("thr_d3a");
  render(markers(["thr_d3a"]));
  act(() => relay.listeners.get("thr_d3a")?.error());
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  act(() => relay.listeners.get("thr_d3a")?.open());
  const early = pendingHistory("thr_d3a");
  act(() => relay.listeners.get("thr_d3a")?.error());
  await act(async () => {
    early.resolve({ records: [], truncated: false, awake: false });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(savedIn("thr_d3a")).toBe(true);

  act(() => relay.listeners.get("thr_d3a")?.open());
  await finishHistory("thr_d3a");
  expect(savedIn("thr_d3a")).toBe(false);
});

it("D2: a failed history read on return counts as feed loss", async () => {
  await openThread("thr_d4a");
  render(markers(["thr_d4a"]));
  act(() => showPage());
  await act(async () => {
    pendingHistory("thr_d4a").reject(new Error("Cloudroom is unreachable. Try again."));
    await vi.advanceTimersByTimeAsync(0);
  });
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  expect(savedIn("thr_d4a")).toBe(true);
});

it("D2 control: short relay flaps that recover within the grace period never show a saved copy", async () => {
  await openThread("thr_d5a");
  render(markers(["thr_d5a"]));
  for (let flap = 0; flap < 3; flap += 1) {
    act(() => relay.listeners.get("thr_d5a")?.error());
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => relay.listeners.get("thr_d5a")?.open());
    if (relay.history.some((item) => item.threadId === "thr_d5a")) await finishHistory("thr_d5a");
    expect(savedIn("thr_d5a")).toBe(false);
  }
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  expect(savedIn("thr_d5a")).toBe(false);
});

it("D2: a timeline query answered from the relay's cached events does not clear the saved copy", async () => {
  await openThread("thr_d6a");
  render(markers(["thr_d6a"]));
  act(() => relay.listeners.get("thr_d6a")?.error());
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  expect(savedIn("thr_d6a")).toBe(true);

  await act(async () => {
    await queryClient.fetchQuery({ queryKey: threadTimelineQueryKey("thr_d6a"), queryFn: () => ({ rows: [], maxSeq: 1 }), staleTime: 0 });
  });
  expect(savedIn("thr_d6a")).toBe(true);

  act(() => relay.listeners.get("thr_d6a")?.open());
  await finishHistory("thr_d6a");
  expect(savedIn("thr_d6a")).toBe(false);
});
