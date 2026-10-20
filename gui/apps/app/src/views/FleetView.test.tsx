// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@cloudroom/domain";
import type {
  FleetSupplementResponse,
  SidebarBootstrapResponse,
} from "@cloudroom/server-contract";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";

const NOW = Date.now();
const state = vi.hoisted(() => ({
  compact: false,
  bootstrap: null as unknown,
  supplement: null as unknown,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: state.bootstrap,
    dataUpdatedAt: 1,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/fleet-queries", () => ({
  useFleetArchived: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
  useFleetSupplement: () => ({
    data: state.supplement,
    dataUpdatedAt: NOW,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [] }),
}));
vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadTimeline: () => ({
    data: undefined,
    isPending: true,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironmentPullRequest: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/components/ui/sidebar.js", () => ({
  useSidebar: () => ({
    open: true,
    toggleSidebar: vi.fn(),
    isCompactViewport: state.compact,
  }),
}));

import { FleetView } from "./FleetView";

function entry(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThreadListEntry({
    id,
    projectId: "proj_a",
    title: `Title ${id}`,
    titleFallback: null,
    executionTarget: "cloud",
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    lastReadAt: NOW,
    latestAttentionAt: NOW - 1000,
    updatedAt: NOW - 1000,
    hasPendingInteraction: false,
    queuedWork: "none",
    ...overrides,
  });
}

function seed(threads: ThreadListEntry[], hidden: ThreadListEntry[] = []) {
  const project = (id: string, name: string, list: ThreadListEntry[]) => ({
    id,
    kind: "standard" as const,
    name,
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
    sources: [],
    threads: list,
    defaultExecutionOptions: null,
  });
  state.bootstrap = {
    sections: [],
    projects: [project("proj_a", "Secret Project", threads)],
    personalProject: project("proj_p", "Personal", []),
  } satisfies SidebarBootstrapResponse;
  state.supplement = {
    source: "fixture",
    generatedAt: NOW,
    hiddenThreads: hidden,
    archivedThreads: [],
    extraProjects: [],
    archivedCount: 0,
    archivedTruncated: false,
    archivedParentIds: [],
    threadFields: {},
    pendingFields: [],
    unavailableSources: [],
  } satisfies FleetSupplementResponse;
}

function renderView() {
  return render(
    <Provider store={createStore()}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FleetView />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  state.compact = false;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("FleetView", () => {
  it("renders every thread exactly once, with lifted attention children returned in their family", () => {
    seed([
      entry("p"),
      entry("c", { parentThreadId: "p", hasPendingInteraction: true }),
      entry("q"),
    ]);
    renderView();
    const cards = document.querySelectorAll("[data-fleet-card]");
    expect(
      [...cards].map((card) => card.getAttribute("data-fleet-card")).sort(),
    ).toEqual(["c", "p", "q"]);
    expect(
      screen.getByRole("button", { name: /Go to Title c in Needs attention/ }),
    ).toBeTruthy();
  });

  it("closes details with Escape pressed inside the inspector and returns focus to the card", async () => {
    seed([entry("a")]);
    renderView();
    const open = screen.getByRole("button", { name: /Open details: Title a/ });
    fireEvent.click(open);
    const inspector = screen.getByRole("complementary", {
      name: "Thread details",
    });
    const close = within(inspector).getByRole("button", {
      name: "Close details",
    });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(
      screen.queryByRole("complementary", { name: "Thread details" }),
    ).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Open details: Title a/ }),
      ),
    );
  });

  it("on phone, a ghost return to a paged-out attention card expands the list and focuses it", async () => {
    state.compact = true;
    const children = ["c1", "c2", "c3", "c4", "c5"].map((id, index) =>
      entry(id, {
        parentThreadId: "p",
        hasPendingInteraction: true,
        latestAttentionAt: NOW - index * 1000,
      }),
    );
    seed([entry("p"), ...children]);
    renderView();
    expect(screen.getByRole("button", { name: /Show all 5/ })).toBeTruthy();
    expect(document.querySelector('[data-fleet-card="c5"]')).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Go to Title c5 in Needs attention/ }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-fleet-card="c5"]')).not.toBeNull(),
    );
    await waitFor(() =>
      expect(
        document.activeElement?.closest('[data-fleet-card="c5"]'),
      ).not.toBeNull(),
    );
  });

  it("keeps the family toggle on a parent that is lifted into Needs attention", () => {
    seed([
      entry("p", { hasPendingInteraction: true }),
      entry("c", { parentThreadId: "p" }),
    ]);
    renderView();
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(
      within(attention).getByRole("button", {
        name: /Collapse family of Title p: 1 child/,
      }),
    ).toBeTruthy();
  });

  it("hides titles, project names and hidden-thread names from text, accessible names and search", () => {
    seed(
      [entry("a")],
      [
        entry("s", {
          visibility: "hidden",
          originKind: "fork",
          originPluginId: "side-chat",
          sourceThreadId: "a",
        }),
      ],
    );
    window.localStorage.setItem("bb.fleet.hideTitles", "1");
    renderView();
    const view = screen.getByTestId("fleet-view");
    const labels = [...view.querySelectorAll("[aria-label]")].map(
      (node) => node.getAttribute("aria-label") ?? "",
    );
    for (const secret of ["Title a", "Title s", "Secret Project"]) {
      expect(view.textContent).not.toContain(secret);
      expect(labels.some((label) => label.includes(secret))).toBe(false);
    }
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search fleet threads" }),
      { target: { value: "Title a" } },
    );
    expect(document.querySelectorAll("[data-fleet-card]").length).toBe(0);
  });

  it("clears a typed title from search when privacy is turned on", () => {
    seed([entry("a")]);
    renderView();
    const search = screen.getByRole("searchbox", {
      name: "Search fleet threads",
    }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "Title a" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Hide titles in Fleet: Off/ }),
    );
    expect(search.value).toBe("");
    expect(screen.getByTestId("fleet-view").textContent).not.toContain(
      "Title a",
    );
  });

  it("gives a nested parent its own family toggle that hides only its children", () => {
    seed([
      entry("root"),
      entry("mid", { parentThreadId: "root" }),
      entry("leaf", { parentThreadId: "mid" }),
    ]);
    renderView();
    const toggle = screen.getByRole("button", {
      name: /Collapse family of Title mid: 1 child/,
    });
    expect(document.querySelector('[data-fleet-card="leaf"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(document.querySelector('[data-fleet-card="leaf"]')).toBeNull();
    expect(document.querySelector('[data-fleet-card="mid"]')).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Collapse family of Title root: 2 children/,
      }),
    ).toBeTruthy();
  });

  it("on phone, contains focus in the details drawer instead of the cards behind it", () => {
    state.compact = true;
    seed([entry("a"), entry("b")]);
    renderView();
    fireEvent.click(
      screen.getByRole("button", { name: /Open details: Title a/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button, [href], [tabindex]:not([tabindex='-1'])",
      ),
    ];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  it("on phone, keeps grid shortcuts from moving focus behind the open drawer", () => {
    state.compact = true;
    seed([entry("a"), entry("b", { status: "error" })]);
    renderView();
    fireEvent.click(
      screen.getByRole("button", { name: /Open details: Title a/ }),
    );
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close details" });
    close.focus();
    for (const key of ["n", "N", "/", "ArrowRight"]) {
      fireEvent.keyDown(close, { key });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
