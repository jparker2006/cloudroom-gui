// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const panel = app.threadPanelActions.find((entry) => entry.id === "pull")!;

type Sources = Array<"workspace" | "review">;

function pull(number: number, overrides: Record<string, unknown> = {}) {
  return {
    repo: "acme/widgets",
    number,
    id: `PR_${number}`,
    title: `Pull ${number}`,
    state: "OPEN",
    author: "octocat",
    body: "",
    url: `https://github.com/acme/widgets/pull/${number}`,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    baseRefName: "main",
    headRefName: `feature-${number}`,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    labels: [],
    assignees: [],
    reviewDecision: "",
    mergeStateStatus: "CLEAN",
    reviewRequests: [],
    checks: [],
    comments: [],
    reviews: [],
    reviewThreads: [],
    files: [],
    ...overrides,
  };
}

function association(
  threadId: string,
  resolution: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    threadId,
    environmentId: null,
    selection: null,
    candidates: [],
    failures: [],
    resolution,
    ...extra,
  };
}

function candidate(number: number, sources: Sources) {
  return {
    threadId: "thr-1",
    environmentId: "env-1",
    selection: null,
    candidates: [{ repo: "acme/widgets", number, sources }],
    failures: [],
    resolution: { kind: "candidate", repo: "acme/widgets", number, sources },
  };
}

const base = {
  listItems: () => ({ items: [] }),
  listLinks: () => ({ links: {} }),
  cachedPull: () => ({ cached: null }),
};

function render(
  rpc: Record<string, (...args: never[]) => unknown>,
  threadId = "thr-1",
) {
  return renderSlot(
    panel,
    { threadId, params: null },
    { rpc: { ...base, ...rpc } },
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("session PR panel association", () => {
  it("shows a lookup failure instead of 'no pull request linked'", async () => {
    const slot = render({
      pullForThread: () => {
        throw new Error("gh: HTTP 502 Bad Gateway");
      },
    });
    await settle();

    const text = slot.container.textContent ?? "";
    expect(text).not.toMatch(/no pull request/i);
    expect(text).toContain("GitHub or the workspace is unavailable");
    expect(text).toContain("HTTP 502");
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("getPull");
    slot.lifecycle.unmount();
  });

  it("separates auth failure from confirmed no-match", async () => {
    const failed = render({
      pullForThread: () =>
        association("thr-1", {
          kind: "failed",
          reason: "auth",
          message: "HTTP 401: Bad credentials",
        }),
    });
    await settle();
    expect(failed.container.textContent).toContain("GitHub sign-in needed");
    expect(failed.container.textContent).not.toMatch(
      /no pull request matches/i,
    );
    failed.lifecycle.unmount();

    const none = render({
      pullForThread: () => association("thr-1", { kind: "none" }),
    });
    await settle();
    expect(none.container.textContent).toContain(
      "No pull request matches this session",
    );
    none.lifecycle.unmount();
  });

  it("requires a choice for ambiguous matches and saves the chosen PR", async () => {
    let saved: unknown = null;
    const slot = render({
      pullForThread: () =>
        association(
          "thr-1",
          { kind: "ambiguous" },
          {
            candidates: [
              { repo: "acme/widgets", number: 42, sources: ["workspace"] },
              { repo: "acme/widgets", number: 39, sources: ["review"] },
            ],
          },
        ),
      setPullForThread: (input: never) => {
        saved = (input as { pull: unknown }).pull;
        return association(
          "thr-1",
          { kind: "selected", repo: "acme/widgets", number: 39 },
          {
            selection: {
              repo: "acme/widgets",
              number: 39,
              id: "PR_39",
              selectedAt: "2026-10-01T00:00:00.000Z",
            },
          },
        );
      },
      getPull: () => ({ pull: pull(39), fetchedAt: new Date().toISOString() }),
    });
    await settle();

    expect(slot.container.textContent).toContain("2 pull requests match");
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("getPull");
    expect(slot.getByText("acme/widgets#42")).toBeTruthy();
    expect(slot.getByText("workspace branch")).toBeTruthy();
    expect(slot.getByText("review thread")).toBeTruthy();

    await act(async () => slot.getByText("acme/widgets#39").click());
    await settle();

    expect(saved).toEqual({ repo: "acme/widgets", number: 39 });
    expect(slot.container.textContent).toContain("Your saved choice");
    expect(slot.container.textContent).toContain("Pull 39");
    expect(slot.getByRole("status").textContent).toContain(
      "Saved acme/widgets#39",
    );
    slot.lifecycle.unmount();
  });

  it("labels a saved choice, flags other matches, and clears to automatic matching", async () => {
    const calls: unknown[] = [];
    const slot = render({
      pullForThread: () =>
        association(
          "thr-1",
          { kind: "selected", repo: "acme/widgets", number: 43 },
          {
            selection: {
              repo: "acme/widgets",
              number: 43,
              id: "PR_43",
              selectedAt: "2026-10-01T00:00:00.000Z",
            },
            candidates: [
              { repo: "acme/widgets", number: 42, sources: ["workspace"] },
            ],
          },
        ),
      setPullForThread: (input: never) => {
        calls.push((input as { pull: unknown }).pull);
        return candidate(42, ["workspace"]);
      },
      getPull: (input: never) => {
        const { number } = input as { number: number };
        return { pull: pull(number), fetchedAt: new Date().toISOString() };
      },
    });
    await settle();

    expect(slot.container.textContent).toContain("Your saved choice");
    expect(slot.container.textContent).toContain(
      "Also matching this session: acme/widgets#42 (workspace branch)",
    );
    await act(async () => slot.getByText("Use automatic matching").click());
    await settle();

    expect(calls).toEqual([null]);
    expect(slot.container.textContent).toContain("Matched by workspace branch");
    expect(slot.container.textContent).toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("refuses to show detail whose GitHub id differs from the saved choice", async () => {
    const slot = render({
      pullForThread: () =>
        association(
          "thr-1",
          { kind: "selected", repo: "acme/widgets", number: 43 },
          {
            selection: {
              repo: "acme/widgets",
              number: 43,
              id: "PR_original",
              selectedAt: "2026-10-01T00:00:00.000Z",
            },
          },
        ),
      getPull: () => ({ pull: pull(43), fetchedAt: new Date().toISOString() }),
    });
    await settle();

    expect(slot.container.textContent).toContain(
      "is no longer the pull request you saved",
    );
    expect(slot.container.textContent).not.toContain("Pull 43");
    slot.lifecycle.unmount();
  });
});

describe("session PR panel freshness and truth", () => {
  it("shows cached detail with its fetch time and keeps it when refresh fails", async () => {
    const fetchedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      cachedPull: () => ({
        cached: { pull: pull(42, { title: "Cached title" }), fetchedAt },
      }),
      getPull: () => {
        throw new Error("HTTP 502 Bad Gateway");
      },
    });
    await settle();

    expect(slot.container.textContent).toContain("Cached title");
    expect(slot.container.textContent).toContain("Refresh failed");
    const time = slot.container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(fetchedAt);
    expect(time?.textContent).toBe("2h ago");
    slot.lifecycle.unmount();
  });

  it("refreshes on demand and announces the outcome", async () => {
    let calls = 0;
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => {
        calls += 1;
        return {
          pull: pull(42, { title: `Fetch ${calls}` }),
          fetchedAt: new Date().toISOString(),
        };
      },
    });
    await settle();
    expect(slot.container.textContent).toContain("Fetch 1");

    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.container.textContent).toContain("Fetch 2");
    expect(slot.getByRole("status").textContent).toBe(
      "Pull request refreshed.",
    );
    slot.lifecycle.unmount();
  });

  it("never shows unknown, absent, or neutral-only checks as passing", async () => {
    for (const [checks, expected] of [
      [null, "Checks unknown"],
      [[], "No checks reported"],
      [
        [{ name: "deploy", status: "neutral", url: "" }],
        "Checks skipped or neutral",
      ],
      [
        [
          { name: "build", status: "success", url: "" },
          { name: "odd", status: "unknown", url: "" },
        ],
        "1 unknown",
      ],
    ] as const) {
      const slot = render({
        pullForThread: () => candidate(42, ["workspace"]),
        getPull: () => ({
          pull: pull(42, { checks }),
          fetchedAt: new Date().toISOString(),
        }),
      });
      await settle();
      const text = slot.container.textContent ?? "";
      expect(text).toContain(expected);
      expect(text).not.toContain("Checks passing");
      slot.lifecycle.unmount();
    }
  });

  it("labels draft, merged, closed, and unknown states in text", async () => {
    for (const [state, label] of [
      ["DRAFT", "Draft"],
      ["MERGED", "Merged"],
      ["CLOSED", "Closed"],
      ["", "State unknown"],
    ] as const) {
      const slot = render({
        pullForThread: () => candidate(42, ["workspace"]),
        getPull: () => ({
          pull: pull(42, { state }),
          fetchedAt: new Date().toISOString(),
        }),
      });
      await settle();
      expect(slot.getAllByText(label).length).toBeGreaterThan(0);
      slot.lifecycle.unmount();
    }
  });

  it("pairs every PR state and check result icon with a text label", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({
        pull: pull(42, {
          state: "MERGED",
          checks: [
            { name: "build", status: "success", url: "" },
            { name: "test", status: "failure", url: "" },
            { name: "lint", status: "pending", url: "" },
            { name: "docs", status: "neutral", url: "" },
            { name: "odd", status: "unknown", url: "" },
          ],
        }),
        fetchedAt: new Date().toISOString(),
      }),
    });
    await settle();

    const badge = slot.getByText("Merged").closest("span, div");
    expect(badge?.querySelector('[data-icon="GitMerge"]')).not.toBeNull();
    for (const [name, icon, label] of [
      ["build", "CircleCheck", "passed"],
      ["test", "CircleX", "failed"],
      ["lint", "Clock", "pending"],
      ["docs", "Unavailable", "neutral or skipped"],
      ["odd", "CircleQuestion", "result unknown"],
    ] as const) {
      const row = slot.getByText(name).closest("li");
      expect(row?.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
      expect(row?.textContent).toContain(label);
    }
    slot.lifecycle.unmount();
  });

  it("keeps commenting and review dispatch out of the session panel", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
    });
    await settle();

    expect(slot.container.textContent).toContain("Pull 42");
    expect(slot.queryByText("Review with agent")).toBeNull();
    expect(slot.queryByPlaceholderText("Leave a comment…")).toBeNull();
    expect(slot.queryByText(/merge/i)).toBeNull();
    slot.lifecycle.unmount();
  });

  it("drops late responses from the previous session after a switch", async () => {
    let releaseSlowLookup: () => void = () => {};
    const slot = render(
      {
        pullForThread: (input: never) => {
          const { threadId } = input as { threadId: string };
          if (threadId === "thr-a") {
            return new Promise((resolve) => {
              releaseSlowLookup = () => resolve(candidate(42, ["workspace"]));
            });
          }
          return association(threadId, { kind: "none" });
        },
        getPull: () => ({
          pull: pull(42),
          fetchedAt: new Date().toISOString(),
        }),
      },
      "thr-a",
    );
    await settle();

    slot.lifecycle.rerender(
      createElement(panel.component, { threadId: "thr-b", params: null }),
    );
    await settle();
    releaseSlowLookup();
    await settle();

    expect(slot.container.textContent).toContain(
      "No pull request matches this session",
    );
    expect(slot.container.textContent).not.toContain("Pull 42");
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("getPull");
    slot.lifecycle.unmount();
  });
});

describe("main GitHub panel keeps its existing actions", () => {
  it("still offers comment and review dispatch in pull request detail", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "pulls/acme/widgets/42" },
      {
        rpc: {
          ...base,
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [{ repo: "acme/widgets", projectId: null }],
            lastSyncedAt: null,
          }),
          getPull: () => ({
            pull: pull(42),
            fetchedAt: new Date().toISOString(),
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );
    await settle();

    expect(slot.getByText("Review with agent")).toBeTruthy();
    expect(slot.getByPlaceholderText("Leave a comment…")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
