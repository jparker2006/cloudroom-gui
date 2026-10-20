// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { RECENT_PROJECTS_STORAGE_KEY } from "@/lib/root-compose-selection";
import { getThreadRoutePath } from "@/lib/route-paths";
import { AppSidebar } from "./AppSidebar";

const commandHandlers = vi.hoisted(
  () => new Map<string, () => boolean | void>(),
);

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (id: string, handler: () => boolean | void) => {
    commandHandlers.set(id, handler);
  },
  useAppCommandShortcut: () => undefined,
  useAppCommandShortcuts: () => new Map(),
  useIndexedAppCommandHandlers: () => {},
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("./ProjectList", () => ({
  ProjectList: () => (
    <div>
      <a
        href="#near"
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id="thr_near"
        data-sidebar-project-id="proj_near"
      >
        Near thread
      </a>
      <div data-sidebar-windowed-nav="thr_far:proj_far" />
    </div>
  ),
}));
vi.mock("./PluginThreadList", () => ({
  PluginThreadList: ({ original }: { original: React.ReactNode }) => original,
}));
vi.mock("./threadListProvider", () => ({
  useThreadListReplacement: () => null,
}));
vi.mock("@/components/plugin/PluginSidebarFooterItems", () => ({
  PluginSidebarFooterDisclosure: () => null,
  PluginSidebarFooterItems: () => null,
  usePluginSidebarFooterDisclosure: () => ({
    activeItem: null,
    activeKey: null,
    dismiss: () => {},
    handleCommand: () => {},
  }),
}));
vi.mock("./SidebarNavigationRegion", () => ({
  SidebarNavigationRegion: () => null,
}));
vi.mock("./SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));
vi.mock("./SidebarUpdatesBadge", () => ({ SidebarUpdatesBadge: () => null }));
vi.mock("./CloudroomSignInButton", () => ({
  CloudroomSignInButton: () => null,
}));
vi.mock("./MacAccessChip", () => ({ MacAccessChip: () => null }));
vi.mock("@/components/CloudQueue", () => ({
  CloudQueueChip: () => null,
  FreePlanCard: () => null,
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => ({}),
}));
vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: false,
    isCreating: false,
    openCreateDialog: () => {},
  }),
}));

let currentPath = "";

function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}

function renderSidebar(activeThread: { projectId: string; threadId: string }) {
  const client = new QueryClient();
  client.setQueryData(systemConfigQueryKey(), {
    dataDir: "/Users/jake/.bb",
  } as never);
  return render(
    <Provider store={createStore()}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[getThreadRoutePath(activeThread)]}>
          <SidebarProvider>
            <AppSidebar
              onResizeMouseDown={() => {}}
              isResizing={false}
              settingsRoutePath="/settings"
              mobileHosted={{ hidden: false }}
            />
          </SidebarProvider>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

const recordedIds = () =>
  Object.values(
    JSON.parse(
      window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) ?? "{}",
    ) as Record<string, { id: string }[]>,
  ).flatMap((entries) => entries.map((entry) => entry.id));

function runCommand(id: string) {
  const handler = commandHandlers.get(id);
  if (!handler) throw new Error(`No handler for ${id}`);
  act(() => {
    handler();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  commandHandlers.clear();
});

afterEach(cleanup);

describe("AppSidebar recent projects", () => {
  it("records the project when a keyboard jump lands on an unrendered thread", () => {
    renderSidebar({ projectId: "proj_near", threadId: "thr_near" });
    expect(recordedIds()).toEqual([]);
    runCommand("thread.next");
    expect(currentPath).toBe(
      getThreadRoutePath({ projectId: "proj_far", threadId: "thr_far" }),
    );
    expect(recordedIds()).toEqual(["proj_far"]);
  });

  it("leaves rendered rows to record through their own click", () => {
    renderSidebar({ projectId: "proj_far", threadId: "thr_far" });
    runCommand("thread.next");
    expect(recordedIds()).toEqual([]);
  });
});
