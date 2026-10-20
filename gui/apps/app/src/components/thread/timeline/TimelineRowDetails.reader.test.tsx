// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TimelineRow } from "@cloudroom/server-contract";
import { commandRow, toolRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { PreviewableOutputBody } from "./OutputViewer";
import { useTimelineWorkRowFullOutput } from "./useTimelineWorkRowFullOutput";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { timelineTurnSummaryDetails: vi.fn() } },
}));
const details = vi.mocked(sdk.threads.timelineTurnSummaryDetails);
const complete = commandRow({
  id: "reader-command",
  callId: "reader-call",
  threadId: "reader-thread",
  turnId: "reader-turn",
  command: "printf COMMAND_ONLY",
  output:
    "\u001b[32mPASS\u001b[0m\nMIDDLE_ONLY <img src=x onerror=alert(1)>\nTAIL",
  sourceSeqStart: 2,
  sourceSeqEnd: 5,
});
const preview = {
  ...complete,
  output: "PASS\n…[output omitted from preview]\nTAIL",
  outputPreview: {
    totalChars: complete.output.length,
    experimental_fullOutputAvailability: "available" as const,
  },
};

function renderRows(rows: TimelineRow[]) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <Wrapper>
        <ThreadTimelineRows
          initialExpanded={new Set(rows.map((row) => row.id))}
          threadId="reader-thread"
          timelineRows={rows}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Wrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  details.mockReset();
});
afterEach(cleanup);

it("opens the selected Reader from the actual command timeline only on output demand", async () => {
  details.mockResolvedValue({ rows: [complete] });
  const view = renderRows([preview]);
  const launch = screen.getByRole("button", { name: "Open output" });
  expect(details).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  launch.focus();
  fireEvent.click(launch);
  const dialog = screen.getByRole("dialog", { name: "Inspect output" });
  await waitFor(() =>
    expect(within(dialog).getByRole("status").textContent).toContain(
      "Complete available output",
    ),
  );
  expect(details).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByText("Command output")).toBeTruthy();
  expect(within(dialog).queryByLabelText("Matching lines")).toBeNull();
  fireEvent.change(within(dialog).getByRole("searchbox"), {
    target: { value: "MIDDLE_ONLY" },
  });
  expect(dialog.querySelector("[data-output-count]")?.textContent).toContain(
    "of 1 matches",
  );
  expect(dialog.querySelector("img,script")).toBeNull();
  expect(view.container.textContent).toContain("output omitted from preview");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(launch));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens the selected Reader for tool output without searching arguments or fetching complete text", () => {
  renderRows([
    toolRow({
      id: "reader-tool",
      threadId: "reader-thread",
      toolName: "Inspect",
      toolArgs: { value: "ARGUMENT_ONLY" },
      output: "TOOL_OUTPUT café 日本語 👩🏽‍💻",
    }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Open output" }));
  const dialog = screen.getByRole("dialog", { name: "Inspect output" });
  expect(within(dialog).getByText("Tool output")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("searchbox"), {
    target: { value: "ARGUMENT_ONLY" },
  });
  expect(dialog.querySelector("[data-output-count]")?.textContent).toContain(
    "0 of 0 matches",
  );
  fireEvent.change(within(dialog).getByRole("searchbox"), {
    target: { value: "日本語" },
  });
  expect(dialog.querySelector("[data-output-count]")?.textContent).toContain(
    "of 1 matches",
  );
  expect(details).not.toHaveBeenCalled();
});

it("does not construct a hidden full-output drawer before the first explicit open", () => {
  const { wrapper } = createQueryClientTestHarness();
  render(<PreviewableOutputBody row={complete} direction="reader" />, {
    wrapper,
  });
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Loaded output", hidden: true }),
  ).toBeNull();
});

it("keeps a hydration failure visible in the inline preview after closing the drawer", async () => {
  details.mockRejectedValue(new Error("fixture hydration failure"));
  const { wrapper } = createQueryClientTestHarness();
  render(<PreviewableOutputBody row={preview} direction="reader" />, {
    wrapper,
  });
  fireEvent.click(screen.getByRole("button", { name: "Open output" }));
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("alert").textContent).toMatch(/load failed/i);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(details).toHaveBeenCalledTimes(1);
});

it("keeps correctly matched cached output when demand is disabled after hydration", async () => {
  details.mockResolvedValue({ rows: [complete] });
  const { wrapper } = createQueryClientTestHarness();
  const { result, rerender } = renderHook(
    ({ enabled }) => useTimelineWorkRowFullOutput(preview, { enabled }),
    { wrapper, initialProps: { enabled: true } },
  );
  await waitFor(() => expect(result.current.output).toBe(complete.output));
  rerender({ enabled: false });
  expect(result.current.state).toBe("loaded");
  expect(result.current.output).toBe(complete.output);
  expect(details).toHaveBeenCalledTimes(1);
});

it("keeps a mismatched detail response failure visible after closing", async () => {
  details.mockResolvedValue({
    rows: [{ ...complete, threadId: "wrong-thread" }],
  });
  const { wrapper } = createQueryClientTestHarness();
  render(<PreviewableOutputBody row={preview} direction="reader" />, {
    wrapper,
  });
  fireEvent.click(screen.getByRole("button", { name: "Open output" }));
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("alert").textContent).toMatch(/load failed/i);
  expect(details).toHaveBeenCalledTimes(1);
});
