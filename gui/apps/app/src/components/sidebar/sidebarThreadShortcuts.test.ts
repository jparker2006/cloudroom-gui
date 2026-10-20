// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  getSidebarTopLevelThreadTarget,
} from "./sidebarThreadShortcuts";

function appendShortcutTarget(root: HTMLElement, threadId?: string) {
  const target = document.createElement("a");
  target.dataset.sidebarThreadShortcutTarget = "";
  if (threadId) {
    target.dataset.sidebarThreadId = threadId;
  }
  root.append(target);
  return target;
}

function appendRow(
  parent: HTMLElement,
  threadId: string,
  { child = false, projectId = "proj_1" } = {},
) {
  const row = appendShortcutTarget(parent, threadId);
  row.dataset.sidebarProjectId = projectId;
  if (child) row.dataset.sidebarThreadChild = "";
  return row;
}

function appendPlaceholder(parent: HTMLElement, value: string) {
  const placeholder = document.createElement("div");
  placeholder.setAttribute("data-sidebar-windowed-nav", value);
  parent.append(placeholder);
}

function topLevelThreadIds(root: HTMLElement) {
  return Array.from(
    { length: 9 },
    (_, index) => getSidebarTopLevelThreadTarget(root, index)?.threadId,
  );
}

describe("sidebar thread shortcuts", () => {
  it("assigns 1 through 9 in rendered row order", () => {
    const root = document.createElement("aside");
    appendShortcutTarget(root);
    const elements = Array.from({ length: 10 }, (_, index) =>
      appendShortcutTarget(root, `thr_${index + 1}`),
    );

    const targets = getSidebarThreadShortcutTargets(root);

    expect(targets).toHaveLength(9);
    expect(
      targets.map(({ element, key, threadId }) => ({ element, key, threadId })),
    ).toEqual(
      elements.slice(0, 9).map((element, index) => ({
        element,
        key: String(index + 1),
        threadId: `thr_${index + 1}`,
      })),
    );
    expect(getSidebarThreadNavigationTargets(root)).toHaveLength(10);
  });

  it("includes windowed-out placeholder threads in navigation order", () => {
    const root = document.createElement("aside");
    appendShortcutTarget(root, "thr_a");
    const placeholder = document.createElement("div");
    placeholder.setAttribute(
      "data-sidebar-windowed-nav",
      "thr_b:proj_1 thr_c:proj_2",
    );
    root.append(placeholder);
    appendShortcutTarget(root, "thr_d");

    const navigation = getSidebarThreadNavigationTargets(root);
    expect(
      navigation.map(({ threadId, projectId, element }) => ({
        threadId,
        projectId,
        mounted: element !== null,
      })),
    ).toEqual([
      { threadId: "thr_a", projectId: null, mounted: true },
      { threadId: "thr_b", projectId: "proj_1", mounted: false },
      { threadId: "thr_c", projectId: "proj_2", mounted: false },
      { threadId: "thr_d", projectId: null, mounted: true },
    ]);

    expect(
      getSidebarThreadShortcutTargets(root).map((target) => target.threadId),
    ).toEqual(["thr_a", "thr_d"]);
  });

  it("numbers top-level threads across pins, projects, and windowed rows", () => {
    const root = document.createElement("aside");
    const pinned = document.createElement("section");
    const projectA = document.createElement("section");
    const projectB = document.createElement("section");
    root.append(pinned, projectA, projectB);
    appendRow(pinned, "pin_parent", { projectId: "proj_b" });
    appendRow(pinned, "pin_child", { child: true, projectId: "proj_b" });
    appendRow(pinned, "pin_orphan_child", { child: true });
    appendRow(projectA, "a1");
    appendRow(projectA, "a1_child", { child: true });
    appendRow(projectA, "a1_grandchild", { child: true });
    appendPlaceholder(
      projectA,
      "a2:proj_1 a2_child:proj_1:child a3:proj_1 a3_child:proj_1:child",
    );
    appendRow(projectA, "a4");
    appendRow(projectB, "pin_parent", { projectId: "proj_b" });
    appendPlaceholder(projectB, "b1:proj_b b2:proj_b");
    appendRow(projectB, "b3", { projectId: "proj_b" });
    appendRow(projectB, "b4", { projectId: "proj_b" });
    appendRow(projectB, "b5", { projectId: "proj_b" });

    expect(topLevelThreadIds(root)).toEqual([
      "pin_parent",
      "a1",
      "a2",
      "a3",
      "a4",
      "b1",
      "b2",
      "b3",
      "b4",
    ]);
    expect(getSidebarTopLevelThreadTarget(root, 2)).toMatchObject({
      element: null,
      projectId: "proj_1",
      threadId: "a2",
    });
    expect(getSidebarTopLevelThreadTarget(root, 1)?.element).toBe(
      projectA.querySelector('[data-sidebar-thread-id="a1"]'),
    );
  });

  it("filters children before choosing the nth top-level thread", () => {
    const root = document.createElement("aside");
    appendRow(root, "parent_1");
    for (let index = 0; index < 12; index += 1) {
      appendRow(root, `child_${index}`, { child: true });
    }
    appendRow(root, "parent_2");

    expect(getSidebarTopLevelThreadTarget(root, 1)?.threadId).toBe("parent_2");
    expect(getSidebarThreadShortcutTargets(root)).toHaveLength(9);
  });

  it("returns nothing for a missing top-level target", () => {
    const root = document.createElement("aside");
    appendRow(root, "only_parent");
    appendRow(root, "child", { child: true });

    expect(getSidebarTopLevelThreadTarget(root, 1)).toBeUndefined();
    expect(getSidebarTopLevelThreadTarget(null, 0)).toBeUndefined();
    expect(
      getSidebarTopLevelThreadTarget(document.createElement("aside"), 0),
    ).toBeUndefined();
  });

  it("does not invent targets from rows without thread identity", () => {
    const root = document.createElement("aside");
    appendShortcutTarget(root);
    appendPlaceholder(root, "missing_project ::child");
    appendRow(root, "real");

    expect(topLevelThreadIds(root)).toEqual([
      "real",
      ...Array.from({ length: 8 }, () => undefined),
    ]);
  });
});
