// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageProvider, UsageWindow } from "./usage-schema.js";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function threadOnMachine(
  hostId: string,
  hostName: string,
): PluginSidebarThread {
  return {
    id: "thread-active",
    projectId: "project-one",
    title: "Active thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: { id: hostId, name: hostName },
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
  };
}

describe("provider usage footer disclosure", () => {
  it("aggregates every machine and shows every provider at once", async () => {
    const pooledAccounts: UsageProvider[] = (
      [
        ["codex", "Codex", "team@example.com", 46],
        ["codex", "Codex", "personal@example.com", 82],
        ["claude-code", "Claude Code", "claude-team@example.com", 97],
      ] as const
    ).map(([providerId, displayName, email, usedPercent]) => ({
      id: email,
      providerId: providerId,
      accountLabel: email,
      displayName: displayName,
      logoUrl: `/api/v1/system/providers/${providerId}/logo`,
      icon: null,
      strings: { iconTint: null },
      signInHint: "Sign in.",
      expiredHint: "Sign in again.",
      observedAt: null,
      usage: {
        status: "ok",
        accountEmail: email,
        planLabel: "Pro",
        windows: [
          {
            id: null,
            kind: "weekly",
            label: "Weekly limit",
            usedPercent: usedPercent,
            resetsAt:
              email === "personal@example.com"
                ? new Date(Date.now() + 51 * 60 * 60_000).toISOString()
                : null,
            cost: null,
          },
        ],
      },
    }));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              machines: [
                {
                  id: "host-m4",
                  displayName: "M4",
                  status: "connected",
                  error: null,
                  providers: [
                    {
                      id: "claude-code",
                      providerId: "claude-code",
                      accountLabel: null,
                      displayName: "Claude Code",
                      logoUrl:
                        "/api/v1/system/providers/claude-code/logo?h=claude",
                      icon: null,
                      strings: {
                        iconTint: { light: "#D97757", dark: "#E38A6E" },
                      },
                      signInHint: "Sign in to Claude Code.",
                      expiredHint: "Sign in to Claude Code again.",
                      observedAt: null,
                      usage: {
                        status: "ok",
                        accountEmail: "claude@example.com",
                        planLabel: "Max",
                        windows: [
                          {
                            id: null,
                            kind: "five-hour",
                            label: "Five-hour limit",
                            usedPercent: 82,
                            resetsAt: new Date(
                              Date.now() + 2 * 60 * 60_000,
                            ).toISOString(),
                            cost: null,
                          },
                        ],
                      },
                    },
                    {
                      id: "codex",
                      providerId: "codex",
                      accountLabel: null,
                      displayName: "Codex",
                      logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
                      icon: null,
                      strings: { iconTint: null },
                      signInHint: "Sign in to Codex.",
                      expiredHint: "Sign in to Codex again.",
                      observedAt: null,
                      usage: {
                        status: "ok",
                        accountEmail: "codex@example.com",
                        planLabel: "Plus",
                        windows: [
                          {
                            id: null,
                            kind: "weekly",
                            label: "Weekly limit",
                            usedPercent: 37,
                            resetsAt: null,
                            cost: null,
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  id: "host-m5",
                  displayName: "M5",
                  status: "connected",
                  error: null,
                  providers: [
                    {
                      id: "codex",
                      providerId: "codex",
                      accountLabel: null,
                      displayName: "Codex",
                      logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
                      icon: null,
                      strings: { iconTint: null },
                      signInHint: "Sign in to Codex.",
                      expiredHint: "Sign in to Codex again.",
                      observedAt: null,
                      usage: {
                        status: "ok",
                        accountEmail: "codex@example.com",
                        planLabel: "Plus",
                        windows: [
                          {
                            id: null,
                            kind: "weekly",
                            label: "Weekly limit",
                            usedPercent: 97,
                            resetsAt: null,
                            cost: null,
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  id: "source:account-pool",
                  displayName: "Account Pooler",
                  status: "connected",
                  error: null,
                  providers: pooledAccounts,
                },
                {
                  id: "host-intel",
                  displayName: "Intel",
                  status: "disconnected",
                  error: null,
                  providers: [],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = await loadPluginApp(() => import("./app"));
    const mounted = await mountPluginContentScripts(app, {
      pluginId: "provider-usage",
    });
    const item = app.experimentalSidebarFooterItems[0];
    expect(item).toMatchObject({
      kind: "disclosure",
      id: "usage",
      label: "Provider usage",
      icon: "ChartColumn",
    });
    if (item?.kind !== "disclosure") throw new Error("missing disclosure");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/provider-usage/rpc/getUsage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            force: false,
            machineIds: null,
            maxAgeMs: 30 * 60_000,
            providerId: null,
          }),
        }),
      ),
    );
    const dismiss = vi.fn();
    const slot = renderSlot(
      item,
      { dismiss, openPluginDetails: vi.fn() },
      {
        context: { threadId: "thread-active" },
        sidebarThreads: {
          threads: [threadOnMachine("host-m5", "M5")],
        },
      },
    );
    expect(
      slot.getByRole("button", { name: "Usage machine: Account Pooler" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("heading", { name: "personal@example.com" }),
    ).toBeTruthy();
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: Account Pooler" }),
      { button: 0 },
    );
    fireEvent.click(slot.getByRole("menuitemradio", { name: "M5" }));
    const machinePicker = slot.getByRole("button", {
      name: "Usage machine: M5",
    });
    expect(
      slot.getByRole("heading", { name: "Codexcodex@example.com" }),
    ).toBeTruthy();
    expect(slot.getByText("3% left")).toBeTruthy();

    fireEvent.pointerDown(machinePicker, { button: 0 });
    fireEvent.click(slot.getByRole("menuitemradio", { name: "M4" }));
    expect(slot.queryByRole("tab")).toBeNull();
    const claudeSection = slot.getByRole("region", { name: "Claude Code" });
    const codexSection = slot.getByRole("region", { name: "Codex" });
    expect(
      claudeSection.querySelector("[data-provider-logo*='claude-code']"),
    ).not.toBeNull();
    expect(
      codexSection.querySelector("[data-provider-logo*='/codex/']"),
    ).not.toBeNull();
    expect(slot.getByText("18% left")).toBeTruthy();
    expect(slot.getByText("63% left")).toBeTruthy();
    expect(slot.getByText("claude@example.com")).toBeTruthy();

    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: M4" }),
      { button: 0 },
    );
    fireEvent.click(slot.getByRole("menuitemradio", { name: "Intel" }));
    expect(
      slot.getByText(
        "Intel is offline. Usage will refresh when it reconnects.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", { name: "Collapse provider usage" }),
    );
    expect(dismiss).toHaveBeenCalledOnce();
    const reloadButton = slot.getByRole("button", {
      name: "Reload provider usage",
    }) as HTMLButtonElement;
    await waitFor(() => expect(reloadButton.disabled).toBe(false));
    const callsBeforeManualRefresh = fetchMock.mock.calls.length;
    fireEvent.click(reloadButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeManualRefresh + 1),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          force: true,
          machineIds: ["host-intel"],
          maxAgeMs: 0,
          providerId: null,
        }),
      }),
    );

    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    window.dispatchEvent(new Event("blur"));
    now.mockReturnValue(5 * 60_000 + 1_001);
    const callsBeforeFocus = fetchMock.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeFocus + 1),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          force: false,
          machineIds: null,
          maxAgeMs: 5 * 60_000,
          providerId: null,
        }),
      }),
    );

    now.mockRestore();
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Usage machine: Intel" }),
      { button: 0 },
    );
    fireEvent.click(
      slot.getByRole("menuitemradio", { name: "Account Pooler" }),
    );
    expect(slot.getAllByRole("region")).toHaveLength(2);
    expect(slot.getAllByText("team@example.com")).toHaveLength(1);
    expect(slot.getAllByText("personal@example.com")).toHaveLength(1);
    expect(slot.getByText("54% left")).toBeTruthy();
    expect(slot.getByText("2d 3h")).toBeTruthy();
    expect(
      slot.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Codex",
      "team@example.com",
      "personal@example.com",
      "Claude Codeclaude-team@example.com",
    ]);
    const windowButton = slot.getByRole("button", {
      name: "Weekly limit: 54% left, 46% used. Reset time not reported. Pace unavailable: no successful measurement time. Last update unavailable.",
    });
    fireEvent.click(windowButton);
    expect(slot.getByText("Reset time not reported.")).toBeTruthy();
    expect(slot.getByText("18% left")).toBeTruthy();
    expect(slot.getByText("3% left")).toBeTruthy();
    const diagnostics = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    for (const failure of [
      () => new Response("bb connect temporarily unavailable", { status: 503 }),
      () => new Response("bb connect is not JSON", { status: 200 }),
      () => Response.json({ ok: true, result: { machines: "invalid" } }),
    ]) {
      await waitFor(() =>
        expect(
          slot
            .getByRole("button", { name: "Reload provider usage" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fetchMock.mockResolvedValueOnce(failure());
      fireEvent.click(
        slot.getByRole("button", { name: "Reload provider usage" }),
      );
      await waitFor(() =>
        expect(
          slot.getByText(
            "Couldn’t refresh usage. Showing the last available update.",
          ),
        ).toBeTruthy(),
      );
      expect(slot.getByText("claude-team@example.com")).toBeTruthy();
      expect(
        slot.queryByText(/Unexpected token|bb connect|invalid JSON/i),
      ).toBeNull();
      fireEvent.click(
        slot.getByRole("button", { name: "Reload provider usage" }),
      );
      await waitFor(() =>
        expect(
          slot.queryByText(
            "Couldn’t refresh usage. Showing the last available update.",
          ),
        ).toBeNull(),
      );
    }
    expect(diagnostics).toHaveBeenCalledTimes(3);
    await mounted.lifecycle.dispose();
  }, 15_000);
});

it.each([
  ["empty", "No accounts report usage yet."],
  ["expired", "Sign in again in the source plugin’s settings."],
  [
    "unauthenticated",
    "Sign in to this account in the source plugin’s settings.",
  ],
  ["no-limits", "No usage limits reported for this plan."],
  [
    "source-error",
    "Couldn’t refresh usage. Showing the last available update.",
  ],
] as const)("renders the %s shared-source state", async (state, expected) => {
  const usage: UsageProvider["usage"] =
    state === "expired" || state === "unauthenticated"
      ? { status: state }
      : {
          status: "ok",
          accountEmail: "review@example.com",
          planLabel: null,
          windows:
            state === "no-limits"
              ? []
              : [
                  {
                    id: null,
                    kind: "weekly",
                    label: "Weekly limit",
                    usedPercent: 42,
                    resetsAt: null,
                    cost: null,
                  },
                ],
        };
  const account: UsageProvider = {
    id: "account",
    providerId: "codex",
    accountLabel: "review@example.com",
    displayName: "Codex",
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in to this account in the source plugin’s settings.",
    expiredHint: "Sign in again in the source plugin’s settings.",
    observedAt: null,
    usage,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          machines: [
            {
              id: "source:pool",
              displayName: "Review pool",
              status: "connected",
              providers: state === "empty" ? [] : [account],
              error: state === "source-error" ? "private backend error" : null,
            },
          ],
        },
      }),
    ),
  );
  const app = await loadPluginApp(() => import("./app"));
  const mounted = await mountPluginContentScripts(app, {
    pluginId: "provider-usage",
  });
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  const slot = renderSlot(item, {
    dismiss: vi.fn(),
    openPluginDetails: vi.fn(),
  });
  await waitFor(() =>
    expect(slot.getByText(expected, { exact: false })).toBeTruthy(),
  );
  if (state === "source-error") {
    expect(slot.getByText("58% left")).toBeTruthy();
    expect(slot.queryByText("private backend error")).toBeNull();
    expect(
      slot.queryByRole("button", { name: "Retry usage refresh" }),
    ).toBeNull();
  }
  await mounted.lifecycle.dispose();
});

it("shows remaining-first windows with measurement freshness, over-limit, unavailable and reset states", async () => {
  const hour = 3600_000;
  const account = (
    id: string,
    observedAt: number | null,
    windows: (Pick<UsageWindow, "label" | "usedPercent" | "resetsAt"> &
      Partial<Pick<UsageWindow, "id" | "kind">>)[],
    extra: Partial<UsageProvider> = {},
  ): UsageProvider => ({
    id,
    providerId: "codex",
    accountLabel: `${id}@example.com`,
    displayName: "Codex",
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in.",
    expiredHint: "Sign in again.",
    observedAt,
    usage: {
      status: "ok",
      accountEmail: `${id}@example.com`,
      planLabel: null,
      windows: windows.map((window) => ({
        id: null,
        kind: "custom",
        ...window,
        cost: null,
      })),
    },
    ...extra,
  });
  const inHours = (hours: number) =>
    new Date(Date.now() + hours * hour).toISOString();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        result: {
          machines: [
            {
              id: "source:pool",
              displayName: "Pool",
              status: "connected",
              error: "Some usage could not be refreshed.",
              providers: [
                account("fresh", Date.now() - 4 * 60_000, [
                  {
                    id: null,
                    kind: "five-hour",
                    label: "Five-hour limit",
                    usedPercent: 28,
                    resetsAt: inHours(1),
                  },
                ]),
                account(
                  "stale",
                  Date.now() - 2 * hour,
                  [{ label: "Weekly limit", usedPercent: 125, resetsAt: null }],
                  { refreshFailed: true },
                ),
                account("zero", Date.now() - 60_000, [
                  {
                    label: "Daily limit",
                    usedPercent: 0,
                    resetsAt: inHours(3),
                  },
                ]),
                account("unknown", null, [
                  {
                    id: null,
                    kind: "custom",
                    label: "Limit hit",
                    usedPercent: null,
                    resetsAt: inHours(2),
                  },
                ]),
                account("reset", Date.now() - 3 * hour, [
                  {
                    id: null,
                    kind: "weekly",
                    label: "Weekly limit",
                    usedPercent: 90,
                    resetsAt: inHours(-1),
                  },
                ]),
              ],
            },
          ],
        },
      }),
    ),
  );
  const app = await loadPluginApp(() => import("./app"));
  const mounted = await mountPluginContentScripts(app, {
    pluginId: "provider-usage",
  });
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  const openPluginDetails = vi.fn();
  const slot = renderSlot(item, { dismiss: vi.fn(), openPluginDetails });
  await slot.findByText("fresh@example.com");
  expect(slot.getByText("72% left")).toBeTruthy();
  expect(
    slot.getByText(
      "Pace in percentage points. Compared with even usage through this window.",
    ),
  ).toBeTruthy();
  expect(slot.getByText("updated 4 min ago")).toBeTruthy();
  expect(slot.getByText("updated 2 hr ago")).toBeTruthy();
  expect(slot.getByText("Couldn’t refresh")).toBeTruthy();
  expect(slot.getByText("0% left")).toBeTruthy();
  expect(slot.getByText("Over limit · 125% used")).toBeTruthy();
  expect(slot.getByText("Last update unavailable")).toBeTruthy();
  expect(slot.getByText("usage not reported")).toBeTruthy();
  expect(slot.getByText("100% left")).toBeTruthy();
  expect(slot.getByText("reset since last update")).toBeTruthy();
  expect(slot.queryByText("10% left")).toBeNull();
  expect(slot.getAllByText("100% left")).toHaveLength(1);
  expect(
    slot.getByRole("button", {
      name: "Weekly limit: Over limit · 0% left, 125% used. Reset time not reported. Pace unavailable: window length not reported. Updated 2 hr ago · Couldn’t refresh.",
    }),
  ).toBeTruthy();
  const reset = slot.getByRole("button", {
    name: "Weekly limit: Reset since last update. Updated 3 hr ago.",
  });
  fireEvent.click(reset);
  expect(slot.getByText("Reset since last update.")).toBeTruthy();
  expect(slot.queryByText("Resetting now")).toBeNull();
  expect(slot.getByText(/Showing the last available update/)).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "View usage details" }));
  expect(openPluginDetails).toHaveBeenCalledOnce();
  const settings = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: () => ({
          machines: [
            {
              id: "source:other",
              displayName: "Other",
              status: "connected",
              error: null,
              providers: [],
            },
            {
              id: "source:pool",
              displayName: "Pool",
              status: "connected",
              error: null,
              providers: [],
            },
          ],
        }),
      },
    },
  );
  expect(
    (await settings.findByRole("button", { name: "Usage source" })).textContent,
  ).toContain("Pool");
  await mounted.lifecycle.dispose();
});
