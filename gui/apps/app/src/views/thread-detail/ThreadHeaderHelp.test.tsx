// @vitest-environment jsdom
import { PERSONAL_PROJECT_ID } from "@cloudroom/domain";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cloudroom/shared-ui/dropdown-menu";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { THREAD_HELP_HASH } from "@/components/thread-help/thread-help-topics";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import {
  ThreadHeaderHelpButton,
  threadHelpMenuAction,
} from "./ThreadHeaderHelp";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const pane = {
  paneId: "pane-1",
  isFocused: true,
  isSplitPane: false,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: false,
  isTopRow: true,
  ownsWindowTopLeft: false,
  navigateInPane: () => undefined,
} satisfies PaneContextValue;

function Header() {
  const navigate = useNavigate();
  const help = threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-a",
  });
  return (
    <PaneContext.Provider value={pane}>
      <ThreadHeaderHelpButton threadId="thr-a" relevantTopicIds={[]} />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Thread actions">…</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={help.onSelect}>
            {help.label}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PaneContext.Provider>
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const search = () =>
  screen.queryByRole("searchbox", { name: "Search thread help" });

async function openMenuByKeyboard() {
  render(
    <MemoryRouter initialEntries={["/threads/thr-a"]}>
      <Header />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole("button", { name: "Thread actions" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menuitem", { name: "Help" });
}

it("keeps focus in help when Help is chosen from the thread menu by keyboard", async () => {
  const item = await openMenuByKeyboard();
  fireEvent.keyDown(item, { key: "Enter" });
  await waitFor(() => expect(search()).toBeTruthy());
  await settle();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(search());
});

it("moves focus into help when Help is chosen from the thread menu by pointer", async () => {
  const item = await openMenuByKeyboard();
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
  await waitFor(() => expect(search()).toBeTruthy());
  await settle();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(search());
});

it("opens a topic link only while its pane is focused, even on its own route", async () => {
  const renderAt = (isFocused: boolean) =>
    render(
      <MemoryRouter initialEntries={["/threads/thr-a#thread-help/limits"]}>
        <PaneContext.Provider value={{ ...pane, isFocused }}>
          <ThreadHeaderHelpButton threadId="thr-a" relevantTopicIds={[]} />
        </PaneContext.Provider>
      </MemoryRouter>,
    );
  const unfocused = renderAt(false);
  await settle();
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  unfocused.unmount();
  renderAt(true);
  expect(
    await screen.findByRole("heading", {
      level: 3,
      name: "Provider quota, context, and plan limits",
    }),
  ).toBeTruthy();
});

it("keeps the current thread route and search when Help is chosen in the routed pane", async () => {
  window.history.replaceState(null, "", "/threads/thr-a/files?view=diff");
  const navigate = vi.fn();
  threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-a",
  }).onSelect();
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      search: "?view=diff",
      hash: THREAD_HELP_HASH,
    }),
  );
});

it("routes Help chosen in another pane to that pane's thread", async () => {
  window.history.replaceState(null, "", "/threads/thr-a?view=diff");
  const navigate = vi.fn();
  threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-b",
  }).onSelect();
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      pathname: "/threads/thr-b",
      hash: THREAD_HELP_HASH,
    }),
  );
});

it("drops a deferred Help when the user moved to another route before the menu closed", async () => {
  window.history.replaceState(null, "", "/threads/thr-a");
  const navigate = vi.fn();
  threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-a",
  }).onSelect();
  window.history.replaceState(null, "", "/threads/thr-c");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  expect(navigate).not.toHaveBeenCalled();
});
