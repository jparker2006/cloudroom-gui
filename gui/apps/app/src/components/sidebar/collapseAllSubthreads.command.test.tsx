// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { useMemo } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@cloudroom/shared-ui/tooltip";
import {
  applyAppKeybindingOverrides,
  defaultAppSettings,
  type AppDefaultKeybindings,
  type ThreadListEntry,
} from "@cloudroom/domain";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { ProjectThreadTree } from "./ProjectRow";
import {
  collapsedProjectIdsAtom,
  collapsedThreadIdsAtom,
} from "./sidebarCollapsedAtoms";
import { useCollapseAllSubthreadsCommand } from "./collapseAllSubthreads";

const DEFAULTS: AppDefaultKeybindings = [
  {
    command: "sidebar.collapseAllSubthreads",
    desktopOnly: false,
    shortcut: null,
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
  {
    command: "sidebar.collapseAllSubthreads",
    desktopOnly: true,
    shortcut: {
      key: "c",
      mod: true,
      meta: false,
      control: false,
      alt: true,
      shift: false,
    },
    when: { all: ["mainSurface", "macPlatform"], none: ["modalOpen"] },
  },
];

const testState = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      defaultKeybindings: DEFAULTS,
      keybindingOverrides: [],
      keybindings: applyAppKeybindingOverrides(DEFAULTS, []),
    },
  }),
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ commandPaletteActions: [] }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (testState.desktop ? {} : null),
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
  usePromptDraftInputThreadIds: () => new Set(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

function entry(
  id: string,
  projectId: string,
  parentThreadId: string | null = null,
): ThreadListEntry {
  return makeThreadListEntry({
    id,
    projectId,
    parentThreadId,
    title: id,
    titleFallback: id,
  });
}

const PROJECT_1 = [
  entry("alpha", "proj_1"),
  entry("alpha_child", "proj_1", "alpha"),
  entry("alpha_grandchild", "proj_1", "alpha_child"),
  entry("alpha_leaf", "proj_1", "alpha_grandchild"),
  entry("beta", "proj_1"),
  entry("beta_child", "proj_1", "beta"),
];
const PROJECT_2 = [
  entry("gamma", "proj_2"),
  entry("gamma_child", "proj_2", "gamma"),
];
const ALL_THREADS = [...PROJECT_1, ...PROJECT_2];
const SELECTED_ROUTE = "/projects/proj_1/threads/alpha_grandchild";

function Sidebar({ selectedThreadId }: { selectedThreadId: string | null }) {
  const collapsedList = useAtomValue(collapsedThreadIdsAtom);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  useCollapseAllSubthreadsCommand({
    threads: ALL_THREADS,
    selectedThreadId,
  });
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      {[PROJECT_1, PROJECT_2].map((threads) => (
        <ProjectThreadTree
          key={threads[0].projectId}
          threadListState={{ status: "ready", threads }}
          progressiveDisclosureEnabled={false}
          compareThreads={() => 0}
          selectedThreadId={selectedThreadId ?? undefined}
          collapsedThreadIds={collapsed}
          variant="section"
          onToggleThreadCollapsed={vi.fn()}
        />
      ))}
    </>
  );
}

function renderSidebar(
  selectedThreadId: string | null,
  collapsedThreadIds: string[] = [],
) {
  const store = createStore();
  store.set(collapsedThreadIdsAtom, collapsedThreadIds);
  store.set(collapsedProjectIdsAtom, []);
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[SELECTED_ROUTE]}>
            <AppCommandProvider>
              <Sidebar selectedThreadId={selectedThreadId} />
            </AppCommandProvider>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return store;
}

function pressCollapseAll(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "KeyC",
    key: "ç",
    metaKey: true,
    altKey: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function isShown(title: string): boolean {
  return screen.queryByText(title) !== null;
}

let platform: PropertyDescriptor | undefined;

beforeEach(() => {
  platform = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  testState.desktop = true;
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.localStorage.clear();
  if (platform) Object.defineProperty(navigator, "platform", platform);
  else delete (navigator as { platform?: string }).platform;
});

describe("Collapse all subthreads command", () => {
  it("collapses nested trees in every project with Cmd+Option+C and keeps parents", () => {
    const store = renderSidebar(null);
    expect(isShown("beta_child")).toBe(true);
    expect(isShown("gamma_child")).toBe(true);

    const event = pressCollapseAll();

    expect(event.defaultPrevented).toBe(true);
    for (const parent of ["alpha", "beta", "gamma"]) {
      expect(isShown(parent)).toBe(true);
    }
    for (const child of [
      "alpha_child",
      "alpha_grandchild",
      "alpha_leaf",
      "beta_child",
      "gamma_child",
    ]) {
      expect(isShown(child)).toBe(false);
    }
    expect(store.get(collapsedProjectIdsAtom)).toEqual([]);
    expect(
      screen
        .getByRole("button", { name: "Expand beta threads" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("is a no-op on trees that are already collapsed", () => {
    const store = renderSidebar(null, ["alpha", "alpha_child"]);
    pressCollapseAll();
    const first = store.get(collapsedThreadIdsAtom);
    pressCollapseAll();
    expect(store.get(collapsedThreadIdsAtom)).toBe(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("keeps the open child conversation visible and does not navigate", () => {
    renderSidebar("alpha_grandchild");

    pressCollapseAll();

    expect(screen.getByTestId("location").textContent).toBe(SELECTED_ROUTE);
    expect(isShown("alpha")).toBe(true);
    expect(isShown("alpha_child")).toBe(true);
    expect(isShown("alpha_grandchild")).toBe(true);
    expect(isShown("alpha_leaf")).toBe(false);
    expect(isShown("beta_child")).toBe(false);
    expect(isShown("gamma_child")).toBe(false);
  });

  it("runs from a focused text field but not while a modal is open", () => {
    const store = renderSidebar(null);
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    pressCollapseAll(textarea);
    expect(store.get(collapsedThreadIdsAtom)).toContain("beta");

    cleanup();
    const modalStore = renderSidebar(null);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    pressCollapseAll();
    expect(modalStore.get(collapsedThreadIdsAtom)).toEqual([]);
  });

  it("has no default shortcut outside the Mac desktop app", () => {
    testState.desktop = false;
    const store = renderSidebar(null);
    pressCollapseAll();
    expect(store.get(collapsedThreadIdsAtom)).toEqual([]);
  });
});
