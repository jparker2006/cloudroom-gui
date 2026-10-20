// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  RecordedCompactionsList,
  RecordedCompactionsSummary,
  ThreadContextWindowUsage,
} from "@cloudroom/server-contract";
import { sdk } from "@/lib/sdk";
import { ThreadContextWindowCard } from "./ThreadContextWindowIndicator";

vi.mock("@/lib/sdk", () => ({ sdk: { threads: { context: vi.fn() } } }));

const context = vi.mocked(sdk.threads.context);
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
});

const usage: ThreadContextWindowUsage = {
  usedTokens: 142_000,
  modelContextWindow: 200_000,
  estimated: false,
};

const summary: RecordedCompactionsSummary = {
  revision: "r1",
  coverage: "complete",
  gaps: [],
  completedCount: 2,
  inProgress: false,
};

function list(
  overrides: Partial<RecordedCompactionsList> = {},
): RecordedCompactionsList {
  return {
    ...summary,
    entries: [
      {
        kind: "compaction",
        id: "c2",
        status: "completed",
        startedAt: 3_000,
        completedAt: 4_000,
        turnId: "t2",
        summary: "Kept the migration plan.",
      },
      { kind: "clear", id: "clear:2", at: 2_500 },
      {
        kind: "compaction",
        id: "c0",
        status: "unconfirmed",
        startedAt: 1_500,
        completedAt: null,
        turnId: "t0",
        summary: null,
      },
      {
        kind: "compaction",
        id: "c1",
        status: "completed",
        startedAt: 1_000,
        completedAt: 2_000,
        turnId: "t1",
        summary: null,
      },
    ],
    truncated: false,
    ...overrides,
  };
}

function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

it("never renders unknown usage as zero", () => {
  mount(
    <ThreadContextWindowCard
      usage={{ usedTokens: null, modelContextWindow: null, estimated: false }}
      compactions={summary}
      threadId="thread-a"
      open={false}
    />,
  );
  expect(screen.getByText("Usage not reported")).toBeTruthy();
  expect(screen.getByText("Token count not reported")).toBeTruthy();
  expect(screen.queryByText(/0%/)).toBeNull();
  expect(screen.queryByText(/left/)).toBeNull();
});

it("lists recorded compactions newest first with clears as uncounted dividers", async () => {
  context.mockResolvedValue({ usage, compactions: list() });
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />,
  );
  expect(screen.getByText("2 recorded")).toBeTruthy();
  const rows = within(
    await screen.findByRole("list", {
      name: "Recorded compactions, newest first",
    }),
  ).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Kept the migration plan."),
    expect.stringContaining("not a compaction"),
    expect.stringContaining("Not confirmed · not counted"),
    expect.stringContaining("Summary not provided."),
  ]);
  expect(rows[2]?.textContent).not.toContain("Summary");
  expect(context).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: "thread-a" }),
  );
});

it("explains partial history and never shows a bare zero", () => {
  mount(
    <ThreadContextWindowCard
      usage={{ ...usage, estimated: true }}
      compactions={{
        ...summary,
        coverage: "partial",
        gaps: ["cloud-auto-not-reported", "teleported"],
        completedCount: 0,
      }}
      threadId="thread-a"
      open={false}
    />,
  );
  expect(screen.getByText("Estimated context")).toBeTruthy();
  expect(screen.getByText("None in recorded history")).toBeTruthy();
  expect(screen.getByRole("note").textContent).toBe(
    "Partial history. Cloud may not report automatic compactions. Part of this thread ran on another machine.",
  );
});

it("says why compactions are unavailable instead of showing a count", () => {
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={null}
      threadId="thread-a"
    />,
  );
  expect(screen.getByText("Not available")).toBeTruthy();
  expect(screen.getByRole("note").textContent).toContain(
    "Update Cloudroom to see compactions",
  );
  expect(context).not.toHaveBeenCalled();
});

it("announces an in-progress compaction without counting it and shows loading and truncation", async () => {
  let resolve: (value: Awaited<ReturnType<typeof context>>) => void = () => {};
  context.mockReturnValue(new Promise((done) => (resolve = done)));
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={{ ...summary, completedCount: 1, inProgress: true }}
      threadId="thread-a"
    />,
  );
  expect(screen.getByText("1 recorded")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "Compacting now · not counted yet",
  );
  expect(screen.getByText("Loading compactions…")).toBeTruthy();
  resolve({
    usage,
    compactions: list({
      truncated: true,
      entries: [
        {
          kind: "compaction",
          id: "live",
          status: "in_progress",
          startedAt: 5_000,
          completedAt: null,
          turnId: "t3",
          summary: null,
        },
        ...list().entries,
      ],
    }),
  });
  expect(await screen.findByText("Showing newest 50.")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
});

it("does not reuse one thread's list after switching threads", async () => {
  context.mockImplementation(async ({ threadId }) => ({
    usage,
    compactions:
      threadId === "thread-a"
        ? list()
        : list({ completedCount: 0, entries: [], revision: "r-b" }),
  }));
  const view = mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />,
  );
  expect(await screen.findByText("Kept the migration plan.")).toBeTruthy();
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <ThreadContextWindowCard
        usage={usage}
        compactions={{ ...summary, revision: "r-b", completedCount: 0 }}
        threadId="thread-b"
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Kept the migration plan.")).toBeNull();
  expect(screen.getByText("None recorded")).toBeTruthy();
  expect(context).toHaveBeenLastCalledWith(
    expect.objectContaining({ threadId: "thread-b" }),
  );
});

it("refetches the list when the summary revision changes", async () => {
  context.mockResolvedValue({ usage, compactions: list() });
  const view = mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />,
  );
  await screen.findByText("Kept the migration plan.");
  expect(context).toHaveBeenCalledTimes(1);
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <ThreadContextWindowCard
        usage={usage}
        compactions={{ ...summary, revision: "r2" }}
        threadId="thread-a"
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Loading compactions…")).toBeTruthy();
  await screen.findByText("Kept the migration plan.");
  expect(context).toHaveBeenCalledTimes(2);
});
