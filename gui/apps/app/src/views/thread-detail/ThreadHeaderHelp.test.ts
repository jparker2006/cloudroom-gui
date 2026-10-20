// @vitest-environment jsdom
import { PERSONAL_PROJECT_ID } from "@cloudroom/domain";
import { afterEach, expect, it, vi } from "vitest";
import { THREAD_HELP_HASH } from "@/components/thread-help/thread-help-topics";
import { threadHelpMenuAction } from "./ThreadHeaderHelp";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

it("keeps the current thread route and search when Help is chosen in the routed pane", () => {
  window.history.replaceState(null, "", "/threads/thr-a/files?view=diff");
  const navigate = vi.fn();
  threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-a",
  }).onSelect();
  expect(navigate).toHaveBeenCalledWith({
    search: "?view=diff",
    hash: THREAD_HELP_HASH,
  });
});

it("routes Help chosen in another pane to that pane's thread", () => {
  window.history.replaceState(null, "", "/threads/thr-a?view=diff");
  const navigate = vi.fn();
  threadHelpMenuAction(navigate, {
    projectId: PERSONAL_PROJECT_ID,
    threadId: "thr-b",
  }).onSelect();
  expect(navigate).toHaveBeenCalledWith({
    pathname: "/threads/thr-b",
    hash: THREAD_HELP_HASH,
  });
});
