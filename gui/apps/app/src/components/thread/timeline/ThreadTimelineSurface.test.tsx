// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineSurface load-older control", () => {
  it("resumes auto-loading after a context boundary replaces a timeline whose older page failed", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const emitLatestSentinelIntersection = () => {
      act(() => {
        intersectionCallbacks.at(-1)?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    };
    const scrollElement = document.createElement("div");
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 500),
    );
    const anchor = {
      captureScrollAnchor: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: false,
      scrollElementIntoView: vi.fn(),
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const onLoadOlderRows = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server error"))
      .mockReturnValue(new Promise(() => {}));
    const surface = (contextBoundarySeq: number | null) => (
      <BottomAnchorContext.Provider value={anchor}>
        <ThreadTimelineSurface
          activeThinking={null}
          contextBoundarySeq={contextBoundarySeq}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          showOngoingIndicator={false}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          timelineError={false}
          timelineRows={[]}
          workspaceRootPath={undefined}
        />
      </BottomAnchorContext.Provider>
    );
    const view = render(surface(null));

    emitLatestSentinelIntersection();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older messages" }),
      ).not.toBeNull();
    });

    view.rerender(surface(10));
    expect(screen.getByRole("status")).not.toBeNull();

    emitLatestSentinelIntersection();
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });
});

describe("ThreadTimelineSurface empty content", () => {
  const renderSurface = (
    overrides: Partial<Parameters<typeof ThreadTimelineSurface>[0]> = {},
  ) =>
    render(
      <ThreadTimelineSurface
        activeThinking={null}
        contextBoundarySeq={null}
        isThreadTimelinePending={false}
        showOngoingIndicator={false}
        threadId="thread-1"
        threadRuntimeDisplayStatus="idle"
        timelineError={false}
        timelineRows={[]}
        workspaceRootPath={undefined}
        emptyContent={<p>No messages yet</p>}
        {...overrides}
      />,
    );

  it("shows only for a loaded, idle thread with no rows", () => {
    renderSurface();
    expect(screen.getByText("No messages yet")).not.toBeNull();
  });

  it.each<[string, Partial<Parameters<typeof ThreadTimelineSurface>[0]>]>([
    ["loading", { isThreadTimelinePending: true }],
    ["a load error", { timelineError: true }],
    ["active work", { showOngoingIndicator: true }],
    ["unloaded older history", { hasOlderTimelineRows: true }],
    [
      "a host notice",
      { hostConnectionNotice: { label: "Waiting", tone: "pending" as const } },
    ],
    ["a pending thread", { threadRuntimeDisplayStatus: "pending" as const }],
    ["an active thread", { threadRuntimeDisplayStatus: "active" as const }],
    [
      "a reconnecting host",
      { threadRuntimeDisplayStatus: "host-reconnecting" as const },
    ],
  ])("stays hidden during %s", (_, overrides) => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    renderSurface(overrides);
    expect(screen.queryByText("No messages yet")).toBeNull();
  });
});
