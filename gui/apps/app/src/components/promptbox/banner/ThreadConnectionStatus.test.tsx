// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getThreadConnectionStatus } from "@/lib/thread-connection-status";
import { ThreadConnectionStatusBanner, useRecoveredFlash } from "./ThreadConnectionStatus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const notConnected = getThreadConnectionStatus({
  socket: "reconnecting",
  graceElapsed: true,
  browserOffline: false,
  disconnectedAt: Date.now(),
  recovered: false,
  cloud: null,
});
const reconnecting = getThreadConnectionStatus({
  socket: "reconnecting",
  graceElapsed: false,
  browserOffline: false,
  disconnectedAt: Date.now(),
  recovered: false,
  cloud: null,
});

describe("ThreadConnectionStatusBanner", () => {
  it("keeps one polite live region and stays silent during the grace period", () => {
    const { rerender } = render(
      <ThreadConnectionStatusBanner view={reconnecting} onAction={vi.fn()} actionDisabled={false} />,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    expect(screen.getByText("Reconnecting…")).toBeTruthy();

    rerender(<ThreadConnectionStatusBanner view={notConnected} onAction={vi.fn()} actionDisabled={false} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("Not connected");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("wires the details toggle to its region and reveals the unknown cause on demand", () => {
    render(<ThreadConnectionStatusBanner view={notConnected} onAction={vi.fn()} actionDisabled={false} />);
    const toggle = screen.getByRole("button", { name: /Not connected/ });
    const regionId = toggle.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId ?? "");
    expect(region?.getAttribute("aria-labelledby")).toBe(toggle.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region?.textContent).toContain("Unknown");
  });

  it("runs only the action for the diagnosed layer and respects disabled", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ThreadConnectionStatusBanner view={notConnected} onAction={onAction} actionDisabled={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
    expect(onAction).toHaveBeenCalledWith("refresh-connection");
    expect(screen.queryByRole("button", { name: /Retry start|Send/ })).toBeNull();

    rerender(<ThreadConnectionStatusBanner view={notConnected} onAction={onAction} actionDisabled />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(
      <ThreadConnectionStatusBanner view={null} onAction={vi.fn()} actionDisabled={false} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("useRecoveredFlash", () => {
  it("flashes once after a visible outage and clears after four seconds", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ problem }) => useRecoveredFlash(problem), {
      initialProps: { problem: false },
    });
    expect(result.current).toBe(false);
    rerender({ problem: true });
    expect(result.current).toBe(false);
    rerender({ problem: false });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe(false);
  });
});
