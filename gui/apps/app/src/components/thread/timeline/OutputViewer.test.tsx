// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { commandRow, toolRow } from "@/test/fixtures/thread-timeline-rows";
import {
  OutputViewer,
  PreviewableOutputBody,
  outputCoverage,
} from "./OutputViewer";
import type {
  TimelinePreviewableWorkRow,
  TimelineWorkRowFullOutput,
} from "./useTimelineWorkRowFullOutput";
import {
  escapedOutputHtml,
  searchOutputHtml,
  mapOutputAnchor,
} from "./output-search";
import { terminalOutputHtml } from "./TerminalOutputBlock";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { timelineTurnSummaryDetails: vi.fn() } },
}));

const timelineTurnSummaryDetails = vi.mocked(
  sdk.threads.timelineTurnSummaryDetails,
);

const fullOutput = (
  output: string,
  state: TimelineWorkRowFullOutput["state"] = "loaded",
): TimelineWorkRowFullOutput => ({ output, state, retry: vi.fn() });

function previewedCommand() {
  return {
    ...commandRow({
      callId: "call_output_viewer",
      command: "echo COMMAND_SECRET",
      id: "cmd_output_viewer",
      output: "HEAD\n…[4,000 characters omitted from preview]\nTAIL",
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      status: "completed",
      threadId: "thr_output_viewer",
      turnId: "turn_output_viewer",
    }),
    outputPreview: {
      experimental_fullOutputAvailability: "available" as const,
      totalChars: 4_010,
    },
  };
}

function renderViewer(
  row: TimelinePreviewableWorkRow = previewedCommand(),
  output = fullOutput("HEAD\nCOMPLETE BODY\nTAIL"),
) {
  return render(
    <OutputViewer
      row={row}
      direction="reader"
      fullOutput={output}
      open
      onOpenChange={vi.fn()}
    />,
  );
}

function searchInput() {
  return screen.getByRole("searchbox", { name: "Search loaded output" });
}

function outputCount() {
  return document.querySelector<HTMLElement>("[data-output-count]")!;
}

afterEach(cleanup);

beforeEach(() => {
  timelineTurnSummaryDetails.mockReset();
});

describe("output HTML search", () => {
  it("maps repeated lines without jumping to the first occurrence during append or hydration", () => {
    const previous = "head\nrepeat\nrepeat\nrepeat\ntail";
    const offset = previous.lastIndexOf("repeat");
    expect(mapOutputAnchor(previous, previous + "\nlive", offset)).toBe(offset);
    const preview = "head\n[omitted]\nrepeat\ntail";
    const hydrated = "head\nrepeat\nrepeat\nrepeat\ntail";
    expect(
      mapOutputAnchor(preview, hydrated, preview.lastIndexOf("repeat")),
    ).toBe(hydrated.lastIndexOf("repeat"));
    expect(
      mapOutputAnchor(preview, hydrated, preview.indexOf("[omitted]")),
    ).toBeNull();
  });
  it("renders terminal markup as escaped text and safely marks a literal match", () => {
    const raw = '<img src=x onerror="alert(1)"> & <script>alert(2)</script>';
    const terminalHtml = terminalOutputHtml(raw);
    const result = searchOutputHtml(terminalHtml, "<img");
    const parsed = document.createElement("div");
    parsed.innerHTML = result.html;

    expect(terminalHtml).not.toContain("<img");
    expect(result.text).toBe(raw);
    expect(result.matches).toHaveLength(1);
    expect(parsed.querySelector("img, script")).toBeNull();
    expect(parsed.textContent).toBe(raw);
  });

  it("treats unsafe and regex-like queries as literal text", () => {
    const html = escapedOutputHtml("literal .* marker <img src=x>");
    const regexLike = searchOutputHtml(html, ".*");
    const unsafe = searchOutputHtml(
      html,
      '</mark><img src=x onerror="alert(1)">',
    );
    const parsed = document.createElement("div");
    parsed.innerHTML = unsafe.html;

    expect(regexLike.matches).toHaveLength(1);
    expect(regexLike.matches[0]?.excerpt).toContain(".*");
    expect(unsafe.matches).toHaveLength(0);
    expect(parsed.querySelector("img")).toBeNull();
  });

  it("matches text split across ANSI spans and supports Unicode literal search", () => {
    const ansi = terminalOutputHtml("red \u001b[31mblue\u001b[0m");
    const acrossSpans = searchOutputHtml(ansi, "red blue");
    const unicode = searchOutputHtml(
      escapedOutputHtml("a+b café 🐈 says 雪🌙"),
      "CAFÉ 🐈",
    );

    expect(acrossSpans.text).toBe("red blue");
    expect(acrossSpans.matches).toHaveLength(1);
    expect(
      (acrossSpans.html.match(/data-output-match="0"/g) ?? []).length,
    ).toBe(2);
    expect(unicode.matches).toHaveLength(1);
    expect(unicode.matches[0]?.excerpt).toContain("café 🐈");
  });
});

describe("output viewer", () => {
  it("searches loaded output only, excluding command, tool args, and preview omission text", () => {
    const commandView = renderViewer();
    fireEvent.change(searchInput(), { target: { value: "COMMAND_SECRET" } });
    expect(outputCount().textContent).toContain("0 of 0 matches");
    commandView.unmount();

    const tool = {
      ...toolRow({
        callId: "tool_viewer",
        id: "tool_viewer",
        output: "HEAD\n…[4,000 characters omitted from preview]\nTAIL",
        sourceSeqStart: 8,
        sourceSeqEnd: 9,
        threadId: "thr_output_viewer",
        toolArgs: { token: "ARGUMENT_SECRET" },
        toolName: "Inspect",
        turnId: "turn_output_viewer",
      }),
      outputPreview: {
        experimental_fullOutputAvailability: "available" as const,
        totalChars: 4_010,
      },
    };
    renderViewer(tool, fullOutput("HEAD\nACTUAL FULL BODY\nTAIL"));

    for (const term of [
      "COMMAND_SECRET",
      "ARGUMENT_SECRET",
      "characters omitted from preview",
      "UNAVAILABLE_MIDDLE",
    ]) {
      fireEvent.change(searchInput(), { target: { value: term } });
      expect(outputCount().textContent).toContain("0 of 0 matches");
    }

    fireEvent.change(searchInput(), { target: { value: "ACTUAL FULL BODY" } });
    expect(outputCount().textContent).toContain("of 1 matches");
  });

  it("reports the loaded search scope for each availability state", () => {
    const row = previewedCommand();
    const cases: Array<[TimelineWorkRowFullOutput["state"], string]> = [
      ["idle-preview", "Open output to request available details"],
      ["unavailable-preview", "no detail reference is available"],
      ["streaming-preview", "Search covers this loaded preview only"],
      ["loading", "Search covers the loaded preview while loading"],
      ["limited-preview", "omitted output is not searchable"],
      ["expired-preview", "discarded output cannot be recovered"],
      ["error", "Search covers the loaded preview only"],
      ["complete", "Search covers all loaded output"],
      ["loaded", "Search covers all loaded output"],
    ];

    for (const [state, expected] of cases) {
      expect(outputCoverage(row, fullOutput("preview text", state))).toContain(
        expected,
      );
    }
  });

  it("navigates matches with Enter and Shift+Enter, wrapping in either direction", () => {
    renderViewer(previewedCommand(), fullOutput("hit one\nhit two\nhit three"));
    fireEvent.change(searchInput(), { target: { value: "hit" } });
    expect(outputCount().textContent).toContain("0 of 3 matches");

    fireEvent.keyDown(searchInput(), { key: "Enter" });
    expect(outputCount().textContent).toContain("1 of 3 matches");
    fireEvent.keyDown(searchInput(), { key: "Enter" });
    expect(outputCount().textContent).toContain("2 of 3 matches");
    fireEvent.keyDown(searchInput(), { key: "Enter", shiftKey: true });
    expect(outputCount().textContent).toContain("1 of 3 matches");
    fireEvent.keyDown(searchInput(), { key: "Enter", shiftKey: true });
    expect(outputCount().textContent).toContain("3 of 3 matches");
  });

  it("does not hydrate until the persistent drawer opens", async () => {
    const row = previewedCommand();
    timelineTurnSummaryDetails.mockResolvedValue({
      rows: [
        commandRow({
          callId: row.callId,
          command: row.command,
          id: row.id,
          output: "HYDRATED OUTPUT",
          sourceSeqStart: row.sourceSeqStart,
          sourceSeqEnd: row.sourceSeqEnd,
          threadId: row.threadId,
          turnId: row.turnId ?? undefined,
        }),
      ],
    });
    const { wrapper } = createQueryClientTestHarness();
    render(<PreviewableOutputBody row={row} direction="reader" />, { wrapper });

    expect(timelineTurnSummaryDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open output" }));
    await waitFor(() =>
      expect(timelineTurnSummaryDetails).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("HYDRATED OUTPUT")).toBeTruthy();
  });

  it("keeps the reading anchor through streamed and hydrated output changes", () => {
    const row = previewedCommand();
    const view = renderViewer(
      row,
      fullOutput(
        "line one\nline two\nline three\nline four",
        "streaming-preview",
      ),
    );
    const scroller = screen.getByRole("region", { name: "Loaded output" });
    const pre = scroller.querySelector("pre")!;
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 400,
    });
    scroller.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        right: 300,
        bottom: 60,
        width: 300,
        height: 60,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    pre.getBoundingClientRect = () => {
      const top = 10 - scroller.scrollTop;
      return {
        top,
        left: 0,
        right: 300,
        bottom: top + 80,
        width: 300,
        height: 80,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 50,
    });
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 12,
    });
    fireEvent.scroll(scroller);

    view.rerender(
      <OutputViewer
        row={{ ...row, status: "pending" }}
        direction="reader"
        fullOutput={fullOutput(
          "line zero\nline one\nline two\nline three\nline four",
          "streaming-preview",
        )}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(scroller.scrollTop).toBe(70);
    expect(scroller.scrollLeft).toBe(12);

    view.rerender(
      <OutputViewer
        row={{ ...row, status: "completed" }}
        direction="reader"
        fullOutput={fullOutput(
          "prefix\nline zero\nline one\nline two\nline three\nline four",
          "loaded",
        )}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(scroller.scrollTop).toBe(90);
    expect(scroller.scrollLeft).toBe(12);
  });

  it("pauses following on wheel or touch and follows again only on request", async () => {
    renderViewer(
      { ...previewedCommand(), status: "pending" },
      fullOutput("live line one\nlive line two", "streaming-preview"),
    );
    const scroller = screen.getByRole("region", { name: "Loaded output" });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    const follow = screen.getByRole("button", { name: "Follow live" });

    fireEvent.click(follow);
    await waitFor(() =>
      expect(screen.getByText("Following live output")).toBeTruthy(),
    );
    act(() => fireEvent.wheel(scroller));
    expect(screen.getByText("Reading position held")).toBeTruthy();

    fireEvent.click(follow);
    await waitFor(() =>
      expect(screen.getByText("Following live output")).toBeTruthy(),
    );
    act(() => fireEvent.touchStart(scroller));
    expect(screen.getByText("Reading position held")).toBeTruthy();

    fireEvent.click(follow);
    await waitFor(() =>
      expect(screen.getByText("Following live output")).toBeTruthy(),
    );
    expect(scroller.scrollTop).toBe(240);
    fireEvent.keyDown(scroller, { key: "PageUp" });
    expect(screen.getByText("Reading position held")).toBeTruthy();
  });
});
