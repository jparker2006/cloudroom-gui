// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import type { ThreadListEntry } from "@cloudroom/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@cloudroom/shared-ui/tooltip";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { RECENT_PROJECTS_STORAGE_KEY } from "@/lib/root-compose-selection";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ThreadRow, resetSidebarTitleDoubleClickForTest } from "./ThreadRow";

function renderRow(
  projectId = "proj_row",
  thread: Partial<ThreadListEntry> = {},
) {
  const client = new QueryClient();
  client.setQueryData(systemConfigQueryKey(), {
    dataDir: "/Users/jake/.bb",
  } as never);
  return render(
    <Provider store={createStore()}>
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            getThreadRoutePath({ projectId, threadId: "thr_row" }),
          ]}
        >
          <TooltipProvider>
            <ThreadActionsProvider>
              <ThreadRow
                projectId={projectId}
                thread={makeThreadListEntry({
                  id: "thr_row",
                  projectId,
                  title: "Picker work",
                  titleFallback: "Picker work",
                  ...thread,
                })}
                crossProjectId={null}
                isActive={false}
                hasComposerDraft={false}
                options={{ kind: "default", depth: 0, isCompact: false }}
              />
            </ThreadActionsProvider>
          </TooltipProvider>
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

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarTitleDoubleClickForTest();
});

afterEach(cleanup);

describe("ThreadRow recent projects", () => {
  it("records the project when Jake opens the thread from the sidebar", () => {
    renderRow();
    expect(recordedIds()).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: /Picker work/ }));
    expect(recordedIds()).toEqual(["proj_row"]);
  });

  it("does not record the second click that starts a title rename", () => {
    renderRow();
    const link = screen.getByRole("link", { name: /Picker work/ });
    fireEvent.click(link);
    window.localStorage.clear();
    fireEvent.click(link);
    expect(recordedIds()).toEqual([]);
  });

  it("ignores restored routes and background thread activity", () => {
    const view = renderRow("proj_row", { updatedAt: 1, status: "idle" });
    view.unmount();
    renderRow("proj_row", {
      updatedAt: 99,
      latestAttentionAt: 99,
      status: "active",
    });
    expect(recordedIds()).toEqual([]);
  });
});
