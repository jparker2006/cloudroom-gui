import { describe, expect, it } from "vitest";
import { parseUiPreferenceValue } from "@cloudroom/domain";
import { collapseAllSubthreadIds } from "./collapseAllSubthreads";

function thread(id: string, parentThreadId: string | null = null) {
  return { id, parentThreadId };
}

const THREADS = [
  thread("a"),
  thread("a1", "a"),
  thread("a1x", "a1"),
  thread("a1x_leaf", "a1x"),
  thread("b"),
  thread("b1", "b"),
  thread("leaf"),
];

describe("collapseAllSubthreadIds", () => {
  it("collapses every parent at every depth and leaves leaves alone", () => {
    expect(collapseAllSubthreadIds([], THREADS, null).sort()).toEqual([
      "a",
      "a1",
      "a1x",
      "b",
    ]);
  });

  it("covers parents from every project in one pass", () => {
    const threads = [
      { ...thread("p1"), projectId: "proj_1" },
      { ...thread("p1c", "p1"), projectId: "proj_1" },
      { ...thread("p2"), projectId: "proj_2" },
      { ...thread("p2c", "p2"), projectId: "proj_2" },
    ];
    expect(collapseAllSubthreadIds([], threads, null).sort()).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("keeps existing ids, adds no duplicates, and is a no-op when already collapsed", () => {
    const current = ["stale", "a"];
    const next = collapseAllSubthreadIds(current, THREADS, null);
    expect(next.slice(0, 2)).toEqual(["stale", "a"]);
    expect(new Set(next).size).toBe(next.length);
    expect(collapseAllSubthreadIds(next, THREADS, null)).toBe(next);
  });

  it("keeps the selected child's ancestor chain open so it stays visible", () => {
    const next = collapseAllSubthreadIds([], THREADS, "a1x_leaf");
    expect(next.sort()).toEqual(["b"]);
  });

  it("re-opens a collapsed ancestor of the selected child", () => {
    const next = collapseAllSubthreadIds(["a1", "b"], THREADS, "a1x_leaf");
    expect(next.sort()).toEqual(["b"]);
  });

  it("collapses a selected parent's own children since the parent stays visible", () => {
    expect(collapseAllSubthreadIds([], THREADS, "a1").sort()).toEqual([
      "a1",
      "a1x",
      "b",
    ]);
  });

  it("stays within the preference limit by dropping the oldest stale ids", () => {
    const stale = Array.from(
      { length: 10_000 },
      (_, index) => `stale_${index}`,
    );
    const next = collapseAllSubthreadIds(stale, THREADS, null);
    expect(next).toHaveLength(10_000);
    expect(next).toEqual(expect.arrayContaining(["a", "a1", "a1x", "b"]));
    expect(next).not.toContain("stale_0");
    expect(next).toContain("stale_9999");
    expect(
      parseUiPreferenceValue("sidebar.collapsedThreads", next).success,
    ).toBe(true);
  });

  it("does not loop on a parent cycle", () => {
    const threads = [thread("x", "y"), thread("y", "x")];
    expect(collapseAllSubthreadIds([], threads, "x")).toEqual([]);
  });
});
