import { afterEach, expect, it, vi } from "vitest";
import { claudeSecret, claudeUsage } from "./claude.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps reported Claude usage above 100%, real zero, and omits blank headers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: {
            "anthropic-ratelimit-unified-5h-utilization": "1.3",
            "anthropic-ratelimit-unified-5h-reset": "1791666000",
            "anthropic-ratelimit-unified-7d-utilization": "",
          },
        }),
    ),
  );
  expect(await claudeUsage(claudeSecret("token"))).toEqual([
    {
      kind: "five-hour",
      label: "Five-hour limit",
      usedPercent: 130,
      resetsAt: 1791666000 * 1000,
    },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          headers: { "anthropic-ratelimit-unified-7d-utilization": "0" },
        }),
    ),
  );
  expect(await claudeUsage(claudeSecret("token"))).toMatchObject([
    { kind: "weekly", usedPercent: 0 },
  ]);
});
