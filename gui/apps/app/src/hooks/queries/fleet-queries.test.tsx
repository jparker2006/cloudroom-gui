// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  request: () => new Promise(() => {}),
  requestOptions: () => ({}),
}));
vi.mock("@/lib/api-server", () => ({
  apiClient: { "fleet-supplement": { $get: () => null } },
}));

import { useFleetSupplement } from "./fleet-queries";

afterEach(() => vi.useRealTimers());

describe("useFleetSupplement", () => {
  it("still refreshes at least once per second under sustained bootstrap updates", () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(({ at }) => useFleetSupplement(at), {
      wrapper,
      initialProps: { at: 1 },
    });
    for (let tick = 2; tick <= 16; tick += 1) {
      vi.advanceTimersByTime(200);
      rerender({ at: tick });
    }
    vi.advanceTimersByTime(1_000);
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
