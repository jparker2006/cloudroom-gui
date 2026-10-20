// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@cloudroom/domain";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { fetchWithAppSurface } from "@/lib/app-surface";
import { hasAnyThreadMetadata } from "@/components/secondary-panel/ThreadMetadataContent";
import { ThreadSubagentChip, ThreadSubagentsRow } from "./ThreadSubagents";

const connection = vi.hoisted(() => ({ state: "connected" }));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { list: vi.fn() } },
}));

vi.mock("@/lib/app-surface", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-surface")>()),
  fetchWithAppSurface: vi.fn(),
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadListRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => connection.state,
}));

const ROOT = "thr_root";

function thread(
  id: string,
  parentThreadId: string | null,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThreadListEntry({
    id,
    projectId: "proj_1",
    parentThreadId,
    createdAt: 1,
    ...overrides,
  });
}

const FAMILY = [
  thread(ROOT, null, { title: "Root" }),
  thread("thr_a", ROOT, {
    title: "Builder",
    executionTarget: "local",
    runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
  }),
  thread("thr_b", ROOT, {
    title: "Reviewer",
    executionTarget: "cloud",
    createdAt: 2,
  }),
  thread("thr_b1", "thr_b", { title: "Helper" }),
  thread("thr_hidden", ROOT, { title: "Secret child", visibility: "hidden" }),
  thread("thr_hidden1", "thr_hidden", { title: "Secret grandchild" }),
];

function seedSidebar(
  queryClient: ReturnType<typeof createQueryClientTestHarness>["queryClient"],
  threads: ThreadListEntry[],
) {
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          id: "proj_1",
          name: "Project",
          createdAt: 1,
          updatedAt: 1,
          threads,
        }),
      ],
    }),
  );
}

function renderWith(node: ReactNode, threads: ThreadListEntry[] | null) {
  const harness = createQueryClientTestHarness();
  if (threads) seedSidebar(harness.queryClient, threads);
  render(node, { wrapper: harness.wrapper });
  return harness;
}

beforeEach(() => {
  connection.state = "connected";
  vi.mocked(sdk.threads.list).mockReset();
  vi.mocked(fetchWithAppSurface).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ThreadSubagentsRow in the Info tab", () => {
  it("lists direct children, nests descendants under their real parent, and never exposes hidden threads", () => {
    renderWith(<ThreadSubagentsRow threadId={ROOT} />, FAMILY);
    const section = screen.getByRole("region", { name: "Subagents" });
    expect(section.id).toBe(`thread-subagents-${ROOT}`);
    expect(within(section).getByText("Builder")).toBeTruthy();
    expect(within(section).getByText("Reviewer")).toBeTruthy();
    expect(within(section).queryByText("Helper")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Secret/);
    expect(document.body.textContent).not.toMatch(/hidden/i);
    fireEvent.click(within(section).getByRole("button", { name: /Reviewer/ }));
    const nested = within(section).getByRole("list", { name: "Threads spawned by Reviewer" });
    expect(within(nested).getByText("Helper")).toBeTruthy();
    expect(sdk.threads.list).not.toHaveBeenCalled();
  });

  it("says nested threads are not loaded when only the direct-child fallback is available", async () => {
    vi.mocked(sdk.threads.list).mockResolvedValue([FAMILY[1]!, FAMILY[2]!]);
    renderWith(<ThreadSubagentsRow threadId={ROOT} />, null);
    await waitFor(() => expect(screen.getByText("Builder")).toBeTruthy());
    expect(sdk.threads.list).toHaveBeenCalledWith(
      expect.objectContaining({ archived: false, parentThreadId: ROOT }),
    );
    expect(document.body.textContent).toMatch(/nested not loaded/i);
    expect(document.body.textContent).not.toMatch(/\b0 nested/);
  });

  it("shows Not recorded for a local child without fetching, and the recorded cloud model and effort setting", async () => {
    vi.mocked(fetchWithAppSurface).mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: "s",
          paused: false,
          model: "gpt-6.1-sol",
          reasoning: "medium",
          error: null,
          pendingDelivery: 0,
        }),
      ),
    );
    renderWith(<ThreadSubagentsRow threadId={ROOT} />, FAMILY);
    fireEvent.click(screen.getByRole("button", { name: /Builder/ }));
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(fetchWithAppSurface).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Reviewer/ }));
    await waitFor(() => expect(screen.getByText(/gpt-6\.1-sol/)).toBeTruthy());
    expect(document.body.textContent).toMatch(/Effort setting: medium/);
    expect(fetchWithAppSurface).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchWithAppSurface).mock.calls[0]?.[0]).toBe(
      "/api/v1/cloudroom/threads/thr_b",
    );
  });

  it("marks counts as last known when the server connection drops", () => {
    connection.state = "disconnected";
    renderWith(<ThreadSubagentsRow threadId={ROOT} />, FAMILY);
    expect(screen.getByText(/Updates paused/)).toBeTruthy();
  });

  it("renders nothing when the thread has no visible subagents", () => {
    renderWith(<ThreadSubagentsRow threadId="thr_b1" />, FAMILY);
    expect(screen.queryByRole("region", { name: "Subagents" })).toBeNull();
  });

  it("keeps the Info tab available for a thread whose only detail is its subagents", () => {
    const bare = {
      thread: { ...FAMILY[0]!, parentThreadId: null, archivedAt: null },
      environment: null,
      environmentProvisioningFailure: false,
      workspaceStatus: undefined,
      workspaceStatusError: null,
      pullRequest: null,
    } as unknown as Parameters<typeof hasAnyThreadMetadata>[0];
    expect(hasAnyThreadMetadata(bare, false)).toBe(false);
    expect(hasAnyThreadMetadata(bare, false, true)).toBe(true);
  });
});

describe("ThreadSubagentChip in the header", () => {
  it("shows the direct count, opens the Info tab, and points at the Subagents section", () => {
    const onToggle = vi.fn();
    renderWith(
      <ThreadSubagentChip threadId={ROOT} isOpen={false} onToggle={onToggle} />,
      FAMILY,
    );
    const chip = screen.getByRole("button", { name: /Subagents: 2 direct, 1 nested/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("sets aria-controls only while the section is open", () => {
    renderWith(<ThreadSubagentChip threadId={ROOT} isOpen onToggle={() => {}} />, FAMILY);
    expect(screen.getByRole("button").getAttribute("aria-controls")).toBe(
      `thread-subagents-${ROOT}`,
    );
  });

  it("does not render for a thread with no subagents", () => {
    renderWith(<ThreadSubagentChip threadId="thr_b1" isOpen={false} onToggle={() => {}} />, FAMILY);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
