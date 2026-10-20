// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const panel = app.threadPanelActions.find((entry) => entry.id === "pull")!;

afterEach(() => {
  document.body.innerHTML = "";
});

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
    candidates: [{ repo: "acme/widgets", number, id: `PR_${number}`, sources }],
    failures: [],
    resolution: {
      kind: "candidate",
      repo: "acme/widgets",
      number,
      id: `PR_${number}`,
      sources,
    },
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
    expect(text).toContain("GitHub is unavailable");
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
      "is no longer the pull request linked to this session",
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
      "Pull request details refreshed.",
    );
    slot.lifecycle.unmount();
  });

  it("announces the outcome of refreshing the match from the no-match view", async () => {
    const slot = render({
      pullForThread: () => association("thr-1", { kind: "none" }),
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.getByRole("status").textContent).toBe(
      "Pull request match refreshed.",
    );
    slot.lifecycle.unmount();
  });

  it("announces a failed match refresh even before any match loaded", async () => {
    const slot = render({
      pullForThread: () => {
        throw new Error("HTTP 502 Bad Gateway");
      },
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.getByRole("status").textContent).toBe(
      "Couldn’t refresh this session’s pull request match.",
    );
    slot.lifecycle.unmount();
  });

  it("does not claim earlier data when a refresh fails with none", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => {
        throw new Error("HTTP 502 Bad Gateway");
      },
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.container.textContent).not.toContain("Pull 42");
    expect(slot.getByRole("status").textContent).toBe(
      "Refreshing pull request details failed.",
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

describe("session PR panel round-3 corrections", () => {
  it("refuses an automatic review match whose GitHub id changed", async () => {
    const slot = render({
      pullForThread: () => ({
        ...candidate(42, ["review"]),
        resolution: {
          kind: "candidate",
          repo: "acme/widgets",
          number: 42,
          id: "PR_original",
          sources: ["review"],
        },
      }),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
    });
    await settle();

    expect(slot.container.textContent).toContain(
      "is no longer the pull request linked to this session",
    );
    expect(slot.container.textContent).not.toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("fails closed when GitHub returns no id for an expected PR", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["review"]),
      getPull: () => ({
        pull: pull(42, { id: "" }),
        fetchedAt: new Date().toISOString(),
      }),
    });
    await settle();

    expect(slot.container.textContent).toContain("can’t be confirmed");
    expect(slot.container.textContent).not.toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("warns when refreshing the match fails after it loaded", async () => {
    let fail = false;
    const slot = render({
      pullForThread: () => {
        if (fail) throw new Error("HTTP 502 Bad Gateway");
        return association("thr-1", { kind: "none" });
      },
    });
    await settle();
    expect(slot.container.textContent).not.toContain("Couldn’t refresh");

    fail = true;
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.container.textContent).toContain(
      "Couldn’t refresh this session’s match.",
    );
    expect(slot.getByRole("status").textContent).toContain(
      "Couldn’t refresh this session’s pull request match.",
    );
    slot.lifecycle.unmount();
  });

  it("keeps detail visible, moves focus into the chooser, and restores it", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
    });
    await settle();

    await act(async () =>
      slot.getByRole("button", { name: "Change…" }).click(),
    );
    await settle();
    expect(document.activeElement?.textContent).toBe(
      "Choose this session’s pull request",
    );
    expect(slot.container.textContent).toContain("Pull 42");

    await act(async () => slot.getByRole("button", { name: "Cancel" }).click());
    await settle();
    expect(document.activeElement?.textContent).toBe("Change…");
    slot.lifecycle.unmount();
  });

  it("locks Cancel while a save is in flight and keeps the old PR on failure", async () => {
    let rejectSave: (error: Error) => void = () => {};
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
      listItems: () => ({
        items: [
          {
            repo: "acme/widgets",
            number: 43,
            kind: "pr",
            title: "Pull 43",
            state: "OPEN",
            author: "octocat",
            labels: [],
            assignees: [],
            url: "https://github.com/acme/widgets/pull/43",
            body: "",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
      setPullForThread: () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Change…" }).click(),
    );
    await settle();
    await act(async () => slot.getByText("acme/widgets#43").click());
    await settle();

    const saving = slot.getByRole("button", { name: "Saving…" });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    rejectSave(
      new Error(
        "acme/widgets#43 was not found, or this GitHub account cannot read it.",
      ),
    );
    await settle();

    expect(slot.getByRole("alert").textContent).toContain(
      "Couldn’t save that choice.",
    );
    expect(slot.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(slot.container.textContent).toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("names the machine and separates missing access from sign-in", async () => {
    const access = render({
      pullForThread: () =>
        association(
          "thr-1",
          {
            kind: "failed",
            reason: "auth",
            message:
              "HTTP 403: Resource protected by organization SAML enforcement",
          },
          {
            failures: [
              {
                source: "workspace",
                runsOn: "workspace",
                reason: "auth",
                message:
                  "HTTP 403: Resource protected by organization SAML enforcement",
              },
            ],
          },
        ),
    });
    await settle();
    expect(access.container.textContent).toContain("GitHub access needed");
    expect(access.container.textContent).toContain(
      "the machine that hosts this thread’s workspace",
    );
    access.lifecycle.unmount();

    const signIn = render({
      pullForThread: () => {
        throw new Error("gh: not logged in to any GitHub hosts");
      },
    });
    await settle();
    expect(signIn.container.textContent).toContain("GitHub sign-in needed");
    expect(signIn.container.textContent).toContain(
      "the machine running the Cloudroom server",
    );
    signIn.lifecycle.unmount();
  });

  it("explains save failures as access versus sign-in on the plugin machine", async () => {
    for (const [message, expected] of [
      [
        "HTTP 403: Resource protected by organization SAML enforcement",
        "GitHub access needed",
      ],
      ["gh: not logged in to any GitHub hosts", "GitHub sign-in needed"],
    ] as const) {
      const slot = render({
        pullForThread: () => association("thr-1", { kind: "none" }),
        listItems: () => ({
          items: [
            {
              repo: "acme/widgets",
              number: 43,
              kind: "pr",
              title: "Pull 43",
              state: "OPEN",
              author: "octocat",
              labels: [],
              assignees: [],
              url: "https://github.com/acme/widgets/pull/43",
              body: "",
              updatedAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        }),
        setPullForThread: () => {
          throw new Error(message);
        },
      });
      await settle();
      await act(async () =>
        slot.getByRole("button", { name: "Choose a PR…" }).click(),
      );
      await settle();
      await act(async () => slot.getByText("acme/widgets#43").click());
      await settle();

      const alert = slot.getByRole("alert").textContent ?? "";
      expect(alert).toContain(expected);
      expect(alert).toContain("the machine running the Cloudroom server");
      expect(slot.container.textContent).toContain(
        "Choose this session’s pull request",
      );
      slot.lifecycle.unmount();
      document.body.innerHTML = "";
    }
  });

  it("keeps detail and explains access on a SAML refresh failure", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      cachedPull: () => ({
        cached: {
          pull: pull(42, { title: "Cached title" }),
          fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        },
      }),
      getPull: () => {
        throw new Error(
          "HTTP 403: Resource protected by organization SAML enforcement",
        );
      },
    });
    await settle();

    expect(slot.container.textContent).toContain("Cached title");
    expect(slot.container.textContent).toContain("GitHub access needed");
    expect(slot.container.textContent).not.toContain("GitHub sign-in needed");
    slot.lifecycle.unmount();
  });

  it("sends identity-check sign-in recovery to the Cloudroom server, not the workspace", async () => {
    const slot = render({
      pullForThread: () =>
        association(
          "thr-1",
          {
            kind: "failed",
            reason: "auth",
            message:
              "Couldn’t confirm acme/renamed#42: gh: not logged in to any GitHub hosts",
          },
          {
            candidates: [
              {
                repo: "acme/renamed",
                number: 42,
                id: null,
                sources: ["workspace"],
              },
              {
                repo: "acme/widgets",
                number: 42,
                id: "PR_42",
                sources: ["review"],
              },
            ],
            failures: [
              {
                source: "workspace",
                runsOn: "server",
                reason: "auth",
                message:
                  "Couldn’t confirm acme/renamed#42: gh: not logged in to any GitHub hosts",
              },
            ],
          },
        ),
    });
    await settle();

    const text = slot.container.textContent ?? "";
    expect(text).toContain("GitHub sign-in needed");
    expect(text).toContain("the machine running the Cloudroom server");
    expect(text).not.toContain("hosts this thread’s workspace");
    expect(text).toContain("acme/renamed#42");
    expect(text).toContain("acme/widgets#42");
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("getPull");
    slot.lifecycle.unmount();
  });

  it("does not say passing when a check was skipped", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({
        pull: pull(42, {
          checks: [
            { name: "build", status: "success", url: "" },
            { name: "docs", status: "neutral", url: "" },
          ],
        }),
        fetchedAt: new Date().toISOString(),
      }),
    });
    await settle();

    expect(slot.container.textContent).not.toContain("Checks passing");
    expect(slot.container.textContent).toContain("1 skipped or neutral");
    slot.lifecycle.unmount();
  });

  it("opens linked agent threads from a keyboard-reachable button", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
      listLinks: () => ({
        links: {
          "pr:acme/widgets#42": [
            {
              kind: "pr",
              repo: "acme/widgets",
              number: 42,
              threadId: "thr-review",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        },
      }),
    });
    await settle();

    const pill = slot.getByRole("button", { name: "Open agent thread" });
    expect(pill.tagName).toBe("BUTTON");
    slot.lifecycle.unmount();
  });

  it("keeps the fetch time current while the panel stays open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const slot = render({
        pullForThread: () => candidate(42, ["workspace"]),
        getPull: () => ({
          pull: pull(42),
          fetchedAt: new Date().toISOString(),
        }),
      });
      await settle();
      expect(slot.container.querySelector("time")?.textContent).toBe("1m ago");

      await act(async () => {
        vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
        vi.advanceTimersByTime(60_000);
      });

      expect(slot.container.querySelector("time")?.textContent).toBe("2h ago");
      slot.lifecycle.unmount();
    } finally {
      vi.useRealTimers();
    }
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

describe("session PR panel accessibility corrections", () => {
  it("announces an identity mismatch revealed by a refresh instead of success", async () => {
    let calls = 0;
    const slot = render({
      pullForThread: () => candidate(42, ["workspace", "review"]),
      getPull: () => {
        calls += 1;
        return {
          pull: pull(42, { id: calls === 1 ? "PR_42" : "PR_reused" }),
          fetchedAt: new Date().toISOString(),
        };
      },
    });
    await settle();
    expect(slot.container.textContent).toContain("Pull 42");

    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();

    expect(slot.getByRole("alert").textContent).toContain(
      "is no longer the pull request linked to this session",
    );
    expect(slot.getByRole("status").textContent).not.toBe(
      "Pull request details refreshed.",
    );
    slot.lifecycle.unmount();
  });

  it("moves focus to the save error after a failed save", async () => {
    let rejectSave: (error: Error) => void = () => {};
    const slot = render({
      pullForThread: () =>
        association(
          "thr-1",
          { kind: "ambiguous" },
          {
            candidates: [
              {
                repo: "acme/widgets",
                number: 42,
                id: "PR_42",
                sources: ["workspace"],
              },
              {
                repo: "acme/widgets",
                number: 43,
                id: "PR_43",
                sources: ["review"],
              },
            ],
          },
        ),
      getPull: () => ({ pull: pull(42), fetchedAt: new Date().toISOString() }),
      setPullForThread: () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    });
    await settle();
    const row = slot.getByText("acme/widgets#43").closest("button")!;
    row.focus();
    await act(async () => row.click());
    await settle();
    rejectSave(new Error("HTTP 403: Resource not accessible by integration"));
    await settle();

    expect(slot.getByRole("alert").textContent).toContain(
      "Couldn’t save that choice.",
    );
    expect(slot.container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(row);
    expect(document.activeElement?.textContent).toContain(
      "Couldn’t save that choice.",
    );
    slot.lifecycle.unmount();
  });

  it("keeps focus in the panel after clearing a saved choice fails", async () => {
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
          },
        ),
      getPull: () => ({ pull: pull(43), fetchedAt: new Date().toISOString() }),
      setPullForThread: () => {
        throw new Error("kv offline");
      },
    });
    await settle();
    const clear = slot.getByRole("button", { name: "Use automatic matching" });
    clear.focus();
    await act(async () => clear.click());
    await settle();

    expect(slot.container.textContent).toContain("Pull 43");
    expect(slot.container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(clear);
    slot.lifecycle.unmount();
  });

  it("does not show the passing icon when a check was skipped", async () => {
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: () => ({
        pull: pull(42, {
          checks: [
            { name: "build", status: "success", url: "" },
            { name: "docs", status: "neutral", url: "" },
          ],
        }),
        fetchedAt: new Date().toISOString(),
      }),
    });
    await settle();

    const summary = slot.getByText(/1 skipped or neutral/).closest("button")!;
    expect(summary.querySelector('[data-icon="CircleCheck"]')).toBeNull();
    expect(summary.querySelector('[data-icon="Unavailable"]')).not.toBeNull();
    slot.lifecycle.unmount();
  });
});

describe("session PR panel save and refresh overlap", () => {
  const trackedPull43 = {
    repo: "acme/widgets",
    number: 43,
    kind: "pr",
    title: "Pull 43",
    state: "OPEN",
    author: "octocat",
    labels: [],
    assignees: [],
    url: "https://github.com/acme/widgets/pull/43",
    body: "",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };

  async function saveWhileRefreshing(refreshDuringSave: boolean) {
    let resolveSave: (value: unknown) => void = () => {};
    const slot = render({
      pullForThread: () => candidate(42, ["workspace"]),
      getPull: (input: never) => {
        const { number } = input as { number: number };
        return { pull: pull(number), fetchedAt: new Date().toISOString() };
      },
      listItems: () => ({ items: [trackedPull43] }),
      setPullForThread: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Change…" }).click(),
    );
    await settle();
    await act(async () => slot.getByText("acme/widgets#43").click());
    await settle();
    if (refreshDuringSave) {
      await act(async () =>
        slot.getByRole("button", { name: "Refresh" }).click(),
      );
      await settle();
    }
    resolveSave(
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
        },
      ),
    );
    await settle();
    await settle();
    return slot;
  }

  it("shows the saved PR when no refresh overlaps the save", async () => {
    const slot = await saveWhileRefreshing(false);

    expect(slot.getByRole("status").textContent).toBe(
      "Saved acme/widgets#43 for this session.",
    );
    expect(slot.container.textContent).toContain("Pull 43");
    expect(slot.container.textContent).not.toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("keeps a successful save when a refresh overlaps it", async () => {
    const slot = await saveWhileRefreshing(true);

    expect(slot.getByRole("status").textContent).toBe(
      "Saved acme/widgets#43 for this session.",
    );
    expect(slot.container.textContent).toContain("Pull 43");
    expect(slot.container.textContent).not.toContain("Pull 42");
    slot.lifecycle.unmount();
  });

  it("does not flash a refresh that started before the save while the save is pending", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    let resolveRead: (value: unknown) => void = () => {};
    let reads = 0;
    const slot = render({
      pullForThread: () => {
        reads += 1;
        if (reads === 1) return candidate(42, ["workspace"]);
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      getPull: (input: never) => {
        const { number } = input as { number: number };
        return { pull: pull(number), fetchedAt: new Date().toISOString() };
      },
      listItems: () => ({ items: [trackedPull43] }),
      setPullForThread: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Change…" }).click(),
    );
    await settle();
    await act(async () => slot.getByText("acme/widgets#43").click());
    await settle();
    resolveRead(association("thr-1", { kind: "none" }));
    await settle();

    expect(slot.container.textContent).not.toContain(
      "No pull request matches this session",
    );
    expect(slot.container.textContent).toContain("Pull 42");

    resolveSave(
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
        },
      ),
    );
    await settle();
    await settle();
    expect(slot.container.textContent).toContain("Pull 43");
    slot.lifecycle.unmount();
  });

  it("ignores a refresh that started before the save finished but answers after it", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    let resolveRead: (value: unknown) => void = () => {};
    let reads = 0;
    const slot = render({
      pullForThread: () => {
        reads += 1;
        if (reads === 1) return candidate(42, ["workspace"]);
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      getPull: (input: never) => {
        const { number } = input as { number: number };
        return { pull: pull(number), fetchedAt: new Date().toISOString() };
      },
      listItems: () => ({ items: [trackedPull43] }),
      setPullForThread: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Change…" }).click(),
    );
    await settle();
    await act(async () => slot.getByText("acme/widgets#43").click());
    await settle();
    await act(async () =>
      slot.getByRole("button", { name: "Refresh" }).click(),
    );
    await settle();
    resolveSave(
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
        },
      ),
    );
    await settle();
    resolveRead(candidate(42, ["workspace"]));
    await settle();
    await settle();

    expect(slot.container.textContent).toContain("Pull 43");
    expect(slot.container.textContent).not.toContain("Pull 42");
    slot.lifecycle.unmount();
  });
});
