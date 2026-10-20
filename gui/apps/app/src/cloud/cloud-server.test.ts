// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => undefined),
  listen: vi.fn(() => () => {}),
}));
vi.mock("./cloud-api", () => ({
  SignedOutError: class extends Error {},
  cloudApi: { send: mocks.send, listen: mocks.listen, history: vi.fn(), threads: vi.fn(async () => []), stop: vi.fn() },
}));
vi.mock("./cloud-mode", () => ({ macOffline: vi.fn(async () => true) }));
vi.mock("@/components/ui/app-toast", () => ({ appToast: { message: vi.fn() } }));
vi.mock("@/lib/ws", () => ({ wsManager: { runWithoutSocket: vi.fn(), handleIncomingMessage: vi.fn() } }));

const { installCloudServer, isMacUnreachableThroughRelay } = await import("./cloud-server");

const originalFetch = window.fetch;
const network = vi.fn(async () => new Response("{}", { status: 200 }));

function sendThroughShim(input: unknown[]) {
  return window.fetch(`${window.location.origin}/api/v1/threads/thr_abc/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, mode: "queue-if-active" }),
  });
}

beforeEach(() => {
  window.fetch = network as unknown as typeof fetch;
  installCloudServer();
});

afterEach(() => {
  window.fetch = originalFetch;
  vi.clearAllMocks();
});

it("refuses a text + attachment send while the Mac is off instead of silently sending only the text", async () => {
  const response = await sendThroughShim([
    { type: "text", text: "Please also add a CSV header row", mentions: [] },
    { type: "localFile", path: "thread-storage/uploads/report.csv", name: "report.csv" },
  ]);

  expect(response.status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("still forwards a text-only send while the Mac is off", async () => {
  const response = await sendThroughShim([{ type: "text", text: "Ship it", mentions: [] }]);

  expect(response.status).toBe(200);
  expect(mocks.send).toHaveBeenCalledWith("thr_abc", "Ship it");
});

it("records the relay's Mac-unreachable evidence when it takes over, and marks its text-only refusal as pre-transport", async () => {
  expect(isMacUnreachableThroughRelay()).toBe(true);
  const response = await sendThroughShim([
    { type: "text", text: "with a file", mentions: [] },
    { type: "localImage", path: "thread-storage/uploads/chart.png" },
  ]);
  expect(response.status).toBe(400);
  expect((await response.json()) as unknown).toMatchObject({ code: "mac_off_text_only" });
  expect(mocks.send).not.toHaveBeenCalled();
});
