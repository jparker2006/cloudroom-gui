// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";
import { buildSubagentTree, summarizeSubagents, type SubagentTotal } from "./subagent-model";
import type { SubagentViewProps } from "./SubagentCards";
import { SubagentComposerCard, SubagentPanelSection } from "./SubagentDirections";

afterEach(() => {
  cleanup();
});

const entries = [
  makeThreadListEntry({ id: "thr_a", projectId: "proj_1", parentThreadId: "thr_root", title: "Reviewer", createdAt: 1 }),
  makeThreadListEntry({ id: "thr_a1", projectId: "proj_2", parentThreadId: "thr_a", title: "Helper", createdAt: 2 }),
];

function props(overrides: Partial<SubagentViewProps> = {}): SubagentViewProps {
  const total: SubagentTotal = { state: "known", directChildCount: 1 };
  const roots = buildSubagentTree("thr_root", entries);
  return {
    roots,
    summary: summarizeSubagents(roots, total),
    total,
    freshness: { state: "live" },
    listState: "ready",
    now: 10_000,
    getExecution: () => ({ state: "not-recorded" }),
    ...overrides,
  };
}

describe("SubagentComposerCard", () => {
  it("shows direct children first and reveals descendants only on expand", () => {
    const onCardExpand = vi.fn();
    render(<SubagentComposerCard {...props({ onCardExpand })} />);
    const summary = screen.getByRole("button", { name: /1 subagent/ });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Helper")).toBeNull();
    const card = screen.getByRole("button", { name: /Reviewer/ });
    fireEvent.click(card);
    expect(onCardExpand).toHaveBeenCalledTimes(1);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    const nested = screen.getByRole("list", { name: "Threads spawned by Reviewer" });
    expect(within(nested).getByText("Helper")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open thread: Reviewer" });
    expect(link.getAttribute("href")).toBe("/projects/proj_1/threads/thr_a");
    const modelRow = screen.getByText("Model").parentElement;
    expect(modelRow?.textContent).toBe("ModelNot recorded");
  });
});

describe("SubagentPanelSection", () => {
  it("does not present a failed list as zero subagents", () => {
    render(
      <SubagentPanelSection
        {...props({ roots: [], listState: "error", total: { state: "unavailable" } })}
      />,
    );
    expect(screen.getByText(/not the same as having none/)).toBeTruthy();
    expect(screen.queryByText(/No open subagents/)).toBeNull();
  });
});
