// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineFileReadWorkRow } from "@cloudroom/server-contract";
import { buildTimelineRowTitle } from "@cloudroom/thread-view";
import { resolveTimelineImagePreviewLink } from "@/lib/thread-local-file-links";
import {
  TimelineTitleView,
  type TimelineTitleActionResolver,
} from "./TimelineTitleView";

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
  const onTitleAction: TimelineTitleActionResolver = (action) => {
    if (action.kind !== "open-image-preview") return null;
    const link = resolveTimelineImagePreviewLink({
      path: action.path,
      workspaceRootPath: "/repo",
    });
    return link === null ? null : () => open(link.path);
  };
  render(
    <div onClick={rowToggle} onKeyDown={rowToggle}>
      <TimelineTitleView title={title} onTitleAction={onTitleAction} />
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
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(link, { key: " " })).toBe(false);

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith("/repo/assets/chart.png");
    expect(rowToggle).not.toHaveBeenCalled();
  });

  it("keeps non-PNG reads as plain text", () => {
    renderFileReadTitle("/repo/notes.txt");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("notes.txt")).not.toBeNull();
  });

  it("ignores key repeats so one held key opens one preview", () => {
    const { open } = renderFileReadTitle("assets/chart.png");
    const link = screen.getByRole("link", { name: "chart.png" });

    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: "Enter", repeat: true });

    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["../secret.png", "secret.png"],
    ["~/Desktop/shot.png", "shot.png"],
    ["file:///tmp/shot.png", "shot.png"],
    ["assets\\..\\..\\shot.png", /shot\.png$/u],
  ])("keeps unsafe PNG path %s as plain text", (path, name) => {
    const { open } = renderFileReadTitle(path);

    expect(screen.queryByRole("link")).toBeNull();
    const text = screen.getByText(name);
    expect(text.className).not.toContain("text-timeline-accent");
    expect(text.className).not.toContain("cursor-pointer");
    fireEvent.click(text);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps PNG reads plain on surfaces without a preview panel", () => {
    const title = buildTimelineRowTitle(fileReadRow("/repo/chart.png"), {
      summaryStyle: "bundle",
      workStyle: "default",
    });
    render(<TimelineTitleView title={title} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("chart.png").className).not.toContain(
      "text-timeline-accent",
    );
  });
});
