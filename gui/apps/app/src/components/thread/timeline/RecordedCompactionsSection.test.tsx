// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  RecordedCompactionsList,
  RecordedCompactionsSummary,
  ThreadContextWindowUsage,
} from "@cloudroom/server-contract";
import { sdk } from "@/lib/sdk";
import {
  ThreadContextWindowCard,
  ThreadContextWindowIndicator,
} from "./ThreadContextWindowIndicator";

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
      usage={null}
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
  expect(
    await screen.findByText(
      "Showing the newest 50 entries. The count includes older recorded compactions.",
    ),
  ).toBeTruthy();
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
  context
    .mockResolvedValueOnce({ usage, compactions: list() })
    .mockResolvedValueOnce({ usage, compactions: list({ revision: "r2" }) });
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

it("does not show a list whose revision disagrees with the summary", async () => {
  context.mockResolvedValue({
    usage,
    compactions: list({ revision: "r-newer", completedCount: 3 }),
  });
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />,
  );
  expect(await screen.findByText("Updating compactions…")).toBeTruthy();
  expect(screen.queryByText("Kept the migration plan.")).toBeNull();
  expect(screen.getByText("2 recorded")).toBeTruthy();
  expect(
    clients[0]!.getQueryData([
      "threadRecordedCompactions",
      "thread-a",
      "r-newer",
    ]),
  ).toMatchObject({ completedCount: 3 });
});

it("states whole-thread scope and the reported-only caveat without implying complete coverage", () => {
  const view = mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={{
        ...summary,
        coverage: "partial",
        gaps: ["provider-unverified"],
      }}
      threadId="thread-a"
      open={false}
    />,
  );
  const caveat =
    "Covers this whole thread. Only compactions the agent reported to Cloudroom are counted.";
  expect(screen.getByRole("heading").textContent).toBe("Recorded compactions");
  expect(screen.getByText("2 recorded")).toBeTruthy();
  expect(screen.getByText(caveat)).toBeTruthy();
  expect(screen.queryByRole("note")).toBeNull();
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <ThreadContextWindowCard
        usage={usage}
        compactions={{
          ...summary,
          coverage: "partial",
          gaps: ["provider-unverified", "repeated-notices"],
        }}
        threadId="thread-a"
        open={false}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("heading").textContent).toBe("Recorded compactions");
  expect(screen.getByText("2 recorded · partial")).toBeTruthy();
  expect(screen.getByText(caveat)).toBeTruthy();
  expect(screen.getByRole("note").textContent).toBe(
    "Partial history. A turn had more than one compaction notice. They can't be reliably told apart, so only the first is counted.",
  );
});

it("announces when an in-progress compaction is recorded", () => {
  const view = mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={{ ...summary, inProgress: true }}
      threadId="thread-a"
      open={false}
    />,
  );
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <ThreadContextWindowCard
        usage={usage}
        compactions={{ ...summary, completedCount: 3, revision: "r3" }}
        threadId="thread-a"
        open={false}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Compaction recorded.",
  );
});

it("does not announce a completion when switching from a compacting thread to another thread", () => {
  const view = mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={{ ...summary, inProgress: true }}
      threadId="thread-a"
      open={false}
    />,
  );
  view.rerender(
    <QueryClientProvider client={clients[0]!}>
      <ThreadContextWindowCard
        usage={usage}
        compactions={{ ...summary, completedCount: 5, revision: "b5" }}
        threadId="thread-b"
        open={false}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("status").textContent).not.toContain("Compaction");
});

it("refetches instead of reusing a mismatched list when the popover reopens on the original revision", async () => {
  context
    .mockResolvedValueOnce({
      usage,
      compactions: list({ revision: "r-later" }),
    })
    .mockResolvedValueOnce({ usage, compactions: list() });
  const card = (
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />
  );
  const first = mount(card);
  expect(await screen.findByText("Updating compactions…")).toBeTruthy();
  first.unmount();
  render(
    <QueryClientProvider client={clients[0]!}>{card}</QueryClientProvider>,
  );
  expect(await screen.findByText("Kept the migration plan.")).toBeTruthy();
  expect(context).toHaveBeenCalledTimes(2);
});

it("moves keyboard focus into the popover even while the list is still loading", async () => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }) as unknown as MediaQueryList,
  );
  context.mockReturnValue(new Promise(() => {}));
  mount(
    <ThreadContextWindowIndicator
      usage={null}
      compactions={{ ...summary, completedCount: 1 }}
      threadId="thread-a"
    />,
  );
  const trigger = screen.getByRole("button", { name: /^Context usage/ });
  trigger.focus();
  fireEvent.click(trigger, { detail: 0 });
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain(
      "Loading compactions…",
    ),
  );
  expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  vi.unstubAllGlobals();
});

it("shows a neutral note instead of a partial-history warning before the agent reports any compaction", () => {
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={{
        ...summary,
        coverage: "partial",
        gaps: ["provider-unverified"],
        completedCount: 0,
      }}
      threadId="thread-a"
      open={false}
    />,
  );
  expect(screen.getByText("None recorded")).toBeTruthy();
  expect(
    screen.getByText(
      "Covers this whole thread. Only compactions the agent reported to Cloudroom are counted.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.queryByText(/0 recorded/)).toBeNull();
});

it("keeps keyboard focus in the card when Retry loads the list", async () => {
  context
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ usage, compactions: list() });
  mount(
    <ThreadContextWindowCard
      usage={usage}
      compactions={summary}
      threadId="thread-a"
    />,
  );
  const retry = await screen.findByRole("button", { name: "Retry" });
  retry.focus();
  fireEvent.click(retry);
  await screen.findByText("Kept the migration plan.");
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Recorded compactions, newest first",
  );
});
