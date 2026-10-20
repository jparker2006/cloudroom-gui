// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineFileReadWorkRow } from "@cloudroom/server-contract";
import { buildTimelineRowTitle } from "@cloudroom/thread-view";
import { TimelineTitleView } from "./TimelineTitleView";

afterEach(cleanup);

function fileReadRow(path: string): TimelineFileReadWorkRow {
  return {
    kind: "work",
    workKind: "file-read",
    id: `read:${path}`,
    callId: `call:${path}`,
    turnId: "turn-1",
    threadId: "thr_one",
    sourceSeqStart: 1,
    sourceSeqEnd: 2,
    startedAt: 1_000,
    createdAt: 1_000,
    completedAt: 2_000,
    status: "completed",
    path,
    cmd: null,
  };
}

function renderFileReadTitle(path: string, open = vi.fn()) {
  const rowToggle = vi.fn();
  const title = buildTimelineRowTitle(fileReadRow(path), {
    summaryStyle: "bundle",
    workStyle: "default",
  });
  render(
    <div onClick={rowToggle} onKeyDown={rowToggle}>
      <TimelineTitleView
        title={title}
        onTitleAction={(action) =>
          action.kind === "open-image-preview" ? () => open(action.path) : null
        }
      />
    </div>,
  );
  return { open, rowToggle };
}

describe("TimelineTitleView image previews", () => {
  it("opens the exact PNG path on click without toggling the row", () => {
    const { open, rowToggle } = renderFileReadTitle("/repo/assets/chart.png");

    fireEvent.click(screen.getByRole("link", { name: "chart.png" }));

    expect(open).toHaveBeenCalledWith("/repo/assets/chart.png");
    expect(rowToggle).not.toHaveBeenCalled();
  });

  it("opens the PNG from the keyboard", () => {
    const { open, rowToggle } = renderFileReadTitle("assets/chart.png");
    const link = screen.getByRole("link", { name: "chart.png" });

    expect(link.tabIndex).toBe(0);
    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: " " });

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith("assets/chart.png");
    expect(rowToggle).not.toHaveBeenCalled();
  });

  it("keeps non-PNG reads as plain text", () => {
    renderFileReadTitle("/repo/notes.txt");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("notes.txt")).not.toBeNull();
  });

  it("keeps PNG reads plain when the host cannot resolve them", () => {
    const title = buildTimelineRowTitle(fileReadRow("../secret.png"), {
      summaryStyle: "bundle",
      workStyle: "default",
    });
    render(<TimelineTitleView title={title} onTitleAction={() => null} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
