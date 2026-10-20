// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@cloudroom/test-helpers/domain-fixtures";
import {
  buildSubagentTree,
  getSubagentStatus,
  summarizeSubagents,
  type SubagentEntry,
} from "./subagent-model";
import { SubagentHeaderChip, SubagentPanelSection } from "./SubagentPanel";

afterEach(() => {
  cleanup();
});

function entry(
  id: string,
  parentThreadId: string,
  displayStatus: SubagentEntry["runtime"]["displayStatus"] = "idle",
  overrides: Partial<SubagentEntry> = {},
): SubagentEntry {
  return makeThreadListEntry({
    id,
    projectId: "proj_1",
    parentThreadId,
    runtime: { displayStatus, hostReconnectGraceExpiresAt: null },
    createdAt: 1,
    ...overrides,
  });
}

const MIXED = [
  entry("thr_a", "thr_root", "active", { title: "Builder" }),
  entry("thr_b", "thr_root", "idle", { title: "Reviewer", hasPendingInteraction: true }),
  entry("thr_b1", "thr_b", "error", { title: "Helper one" }),
  entry("thr_b2", "thr_b", "idle", { title: "Helper two" }),
  entry("thr_b2x", "thr_b2", "idle", { title: "Deep helper" }),
];

describe("review finding 1: status words only state what is recorded", () => {
  it("does not claim a turn is running, never sent, or failed", () => {
    const active = getSubagentStatus(entry("x", "r", "active"));
    const pending = getSubagentStatus(entry("x", "r", "pending"));
    const error = getSubagentStatus(entry("x", "r", "error"));
    expect(active.label).toBe("Active");
    expect(active.detail).not.toMatch(/turn is running/i);
    expect(pending.detail).not.toMatch(/no turn has been sent/i);
    expect(error.label).toBe("Error");
    expect(error.detail).not.toMatch(/last turn failed/i);
  });
});

describe("review finding 2: direct and nested populations stay separate", () => {
  it("counts status for direct children only", () => {
    const roots = buildSubagentTree("thr_root", MIXED);
    const summary = summarizeSubagents(roots);
    expect(summary.directCount).toBe(2);
    expect(summary.nestedCount).toBe(3);
    expect(summary.buckets.failed).toBe(0);
    expect(
      Object.values(summary.buckets).reduce((sum, count) => sum + count, 0),
    ).toBe(2);
  });

  it("shows the direct count on the chip, never direct + nested", () => {
    const roots = buildSubagentTree("thr_root", MIXED);
    render(
      <SubagentHeaderChip
        summary={summarizeSubagents(roots)}
        listState="ready"
        freshness={{ state: "live" }}
        isOpen={false}
        onToggle={() => {}}
      />,
    );
    const chip = screen.getByRole("button", { name: /Subagents/ });
    expect(chip.textContent).not.toContain("5");
    expect(chip.textContent).toContain("2");
  });
});

describe("review finding 4: no hidden-thread existence through counts", () => {
  it("never reports hidden or archived children", () => {
    const roots = buildSubagentTree("thr_root", MIXED);
    render(
      <SubagentPanelSection
        roots={roots}
        summary={summarizeSubagents(roots)}
        freshness={{ state: "live" }}
        listState="ready"
        now={10_000}
        useExecution={() => ({ state: "not-recorded" })}
      />,
    );
    expect(document.body.textContent).not.toMatch(/hidden/i);
    expect(document.body.textContent).not.toMatch(/4 more/);
  });
});

describe("review finding 5 and 7: honest labels in an expanded card", () => {
  it("calls the truncated prompt a preview and counts immediate children correctly", () => {
    const roots = buildSubagentTree("thr_root", MIXED);
    render(
      <SubagentPanelSection
        roots={roots}
        summary={summarizeSubagents(roots)}
        freshness={{ state: "live" }}
        listState="ready"
        now={10_000}
        useExecution={() => ({ state: "not-recorded" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reviewer/ }));
    expect(screen.queryByText("Task")).toBeNull();
    expect(screen.getByText("Prompt preview")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/3 open/);
    expect(document.body.textContent).toMatch(/2 direct · 1 nested deeper/);
  });
});

describe("review finding 6: the chip tells assistive tech the truth", () => {
  const roots = buildSubagentTree("thr_root", MIXED);
  const summary = summarizeSubagents(roots);

  it("does not announce zero counts while loading or after an error", () => {
    for (const listState of ["loading", "error"] as const) {
      render(
        <SubagentHeaderChip
          summary={summarizeSubagents([])}
          listState={listState}
          freshness={{ state: "live" }}
          isOpen={false}
          onToggle={() => {}}
        />,
      );
      const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
      expect(name).not.toMatch(/\b0 direct/);
      expect(name).toMatch(listState === "loading" ? /loading/ : /unknown/);
      cleanup();
    }
  });

  it("announces paused updates and uses a disclosure relationship", () => {
    render(
      <SubagentHeaderChip
        summary={summary}
        listState="ready"
        freshness={{ state: "paused", since: null }}
        isOpen
        onToggle={() => {}}
        controlsId="thread-subagents-thr_root"
      />,
    );
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("aria-label")).toMatch(/updates paused/i);
    expect(chip.hasAttribute("aria-pressed")).toBe(false);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(chip.getAttribute("aria-controls")).toBe("thread-subagents-thr_root");
  });
});
