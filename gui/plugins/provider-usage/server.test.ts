import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { usageListMethod, usageFetchMethod } from "./usage-source-contract.js";
import type { UsageSnapshot } from "./usage-schema.js";

it("lists cheaply, fetches only the selected source/provider, preserves failed measurements, and evicts removed resources", async () => {
  let enabled = true;
  let failure = false;
  let hasWork = true;
  const rpc = vi.fn(async ({ pluginId, method, input }) => {
    if (method === usageListMethod)
      return pluginId === "pool"
        ? {
            label: "Account Pooler",
            resources: [
              {
                id: "claude",
                providerId: "claude-code",
                label: "claude@example.com",
                scope: { kind: "shared" },
              },
              {
                id: "personal",
                providerId: "codex",
                label: "personal@example.com",
                scope: { kind: "shared" },
              },
              ...(hasWork
                ? [
                    {
                      id: "work",
                      providerId: "codex",
                      label: "work@example.com",
                      scope: { kind: "shared" },
                    },
                  ]
                : []),
            ],
          }
        : {
            resources: [
              {
                id: "host",
                providerId: "codex",
                label: "Codex",
                scope: { kind: "host", hostId: "host", hostName: "Machine" },
              },
            ],
          };
    if (failure) throw new Error("Upstream failed");
    return {
      observedAt: 123,
      usage: {
        status: "ok",
        accountEmail: `${input.resourceId}@example.com`,
        planLabel: null,
        windows: [
          {
            id: "week",
            label: "Weekly",
            usedPercent: 42,
            resetsAt: null,
            model: null,
            cost: null,
          },
        ],
      },
    };
  });
  const host = createFakePluginHost({
    pluginId: "provider-usage",
    sdk: {
      system: { config: async () => ({ primaryHostId: null }) },
      hosts: {
        list: async () => [
          makeHostResponse({
            id: "host",
            name: "Machine",
            status: "connected",
          }),
        ],
      },
      providers: {
        list: async () => [
          { id: "codex", displayName: "Codex", logoUrl: "/codex.svg" },
          {
            id: "claude-code",
            displayName: "Claude Code",
            logoUrl: "/claude.svg",
          },
        ],
      },
      plugins: {
        experimental_discoverRpc: async () =>
          enabled
            ? [
                {
                  pluginId: "pool",
                  displayName: "Account Pooler",
                  method: usageListMethod,
                },
                {
                  pluginId: "local",
                  displayName: "Codex",
                  method: usageListMethod,
                },
              ]
            : [],
        callRpc: rpc,
      },
    },
  });
  plugin(host.bb);
  const request = {
    force: false,
    machineIds: null,
    providerId: null,
    maxAgeMs: 60_000,
  };
  try {
    const listed = await host.harness.behavior.callRpc("getUsage", request);
    expect(listed).toMatchObject({
      machines: [
        { id: "host" },
        {
          id: "source:pool",
          providers: [
            { providerId: "codex", usage: null },
            { providerId: "codex", usage: null },
            { providerId: "claude-code", usage: null },
          ],
        },
      ],
    });
    expect(
      rpc.mock.calls.every(([args]) => args.method === usageListMethod),
    ).toBe(true);
    const target = {
      ...request,
      machineIds: ["source:pool"],
      providerId: "codex",
    };
    await host.harness.behavior.callRpc("getUsage", target);
    expect(
      rpc.mock.calls
        .filter(([args]) => args.method === usageFetchMethod)
        .map(([args]) => [
          args.pluginId,
          args.input.resourceId,
          args.input.refresh,
        ]),
    ).toEqual([
      ["pool", "personal", false],
      ["pool", "work", false],
    ]);
    await host.harness.behavior.callRpc("getUsage", target);
    expect(
      rpc.mock.calls.filter(([args]) => args.method === usageFetchMethod),
    ).toHaveLength(2);
    failure = true;
    expect(
      await host.harness.behavior.callRpc("getUsage", {
        ...target,
        force: true,
      }),
    ).toMatchObject({
      machines: [
        { id: "host" },
        {
          id: "source:pool",
          error: "Some usage could not be refreshed.",
          providers: [
            { usage: { status: "ok" } },
            { usage: { status: "ok" } },
            { usage: null },
          ],
        },
      ],
    });
    failure = false;
    hasWork = false;
    expect(
      await host.harness.behavior.callRpc("getUsage", {
        ...target,
        force: true,
      }),
    ).toMatchObject({
      machines: [
        { id: "host" },
        {
          id: "source:pool",
          error: null,
          providers: [{ id: "pool:personal" }, { id: "pool:claude" }],
        },
      ],
    });
    await host.harness.behavior.callRpc("getUsage", {
      ...target,
      providerId: "claude-code",
    });
    expect(
      rpc.mock.calls
        .filter(([args]) => args.method === usageFetchMethod)
        .at(-1)?.[0].input.resourceId,
    ).toBe("claude");
    await host.harness.behavior.callRpc("getUsage", {
      ...target,
      machineIds: null,
    });
    expect(
      rpc.mock.calls
        .filter(([args]) => args.method === usageFetchMethod)
        .at(-1)?.[0].pluginId,
    ).toBe("local");
    enabled = false;
    expect(
      await host.harness.behavior.callRpc("getUsage", request),
    ).toMatchObject({ machines: [{ id: "host", providers: [] }] });
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("keeps an unconfigured shared group without hosts or measurement requests", async () => {
  const rpc = vi.fn(async () => ({ label: "Account Pooler", resources: [] }));
  const host = createFakePluginHost({
    pluginId: "provider-usage",
    sdk: {
      system: { config: async () => ({ primaryHostId: null }) },
      hosts: { list: async () => [] },
      providers: { list: async () => [] },
      plugins: {
        experimental_discoverRpc: async () => [
          { pluginId: "pool", displayName: "Pool", method: usageListMethod },
        ],
        callRpc: rpc,
      },
    },
  });
  plugin(host.bb);
  try {
    await expect(
      host.harness.behavior.callRpc("getUsage", {
        force: false,
        machineIds: null,
        providerId: null,
        maxAgeMs: 0,
      }),
    ).resolves.toEqual({
      machines: [
        {
          id: "source:pool",
          displayName: "Account Pooler",
          status: "connected",
          providers: [],
          error: null,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("collapses known account observations per machine, preserves unknown identities, and normalizes display labels", async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      system: { config: async () => ({ primaryHostId: null }) },
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", status: "connected" }),
        ],
      },
      providers: { list: async () => [] },
      plugins: {
        experimental_discoverRpc: async () => [
          { pluginId: "adapter", displayName: "Adapter" },
          { pluginId: "custom", displayName: "Custom" },
        ],
        callRpc: async ({ pluginId, method }) =>
          method === usageListMethod
            ? {
                resources: [
                  {
                    id: "account",
                    providerId: "codex",
                    accountKey: null,
                    label: "same@example.com",
                    scope: { kind: "host", hostId: "host", hostName: "Host" },
                  },
                  {
                    id: "unknown",
                    providerId: "other",
                    accountKey: null,
                    label: "same@example.com",
                    scope: { kind: "host", hostId: "host", hostName: "Host" },
                  },
                ],
              }
            : {
                accountKey: "issuer:account:1",
                observedAt: 123,
                usage: {
                  status: "ok",
                  accountEmail: "same@example.com",
                  planLabel: "max",
                  plan: { id: "max", multiplier: 20 },
                  windows: [
                    {
                      id: "week",
                      kind: "weekly",
                      label: "168 hour window",
                      model: null,
                      resetsAt: null,
                      cost: null,
                      usedPercent: pluginId === "adapter" ? 42 : 81,
                    },
                  ],
                },
              },
      },
    },
  });
  try {
    plugin(bb);
    const snapshot = await harness.behavior.callRpc("getUsage", {
      force: false,
      machineIds: ["host"],
      providerId: "codex",
      maxAgeMs: 0,
    });
    expect(snapshot).toMatchObject({
      machines: [
        {
          providers: [
            {
              id: "adapter:account",
              usage: {
                planLabel: "Max (20x)",
                windows: [{ label: "Weekly limit", usedPercent: 42 }],
              },
            },
            { id: "adapter:unknown", usage: null },
            { id: "custom:unknown", usage: null },
          ],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("81");
  } finally {
    await harness.lifecycle.dispose();
  }
});

// The sidebar card sends a machine without a provider; v87 fetched nothing for it.
it("fetches every provider on a selected machine when no provider is named", async () => {
  const { bb, harness } = createFakePluginHost({
    sdk: {
      system: { config: async () => ({ primaryHostId: null }) },
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", status: "connected" }),
        ],
      },
      providers: { list: async () => [] },
      plugins: {
        experimental_discoverRpc: async () => [
          { pluginId: "adapter", displayName: "Adapter" },
        ],
        callRpc: async ({ method }) =>
          method === usageListMethod
            ? {
                resources: [
                  {
                    id: "codex",
                    providerId: "codex",
                    label: "Codex",
                    scope: { kind: "host", hostId: "host", hostName: "Host" },
                  },
                ],
              }
            : {
                observedAt: 1,
                usage: {
                  status: "ok",
                  accountEmail: null,
                  planLabel: null,
                  windows: [
                    {
                      id: "week",
                      label: "Weekly",
                      usedPercent: 42,
                      resetsAt: null,
                      model: null,
                      cost: null,
                    },
                  ],
                },
              },
      },
    },
  });
  try {
    plugin(bb);
    const snapshot = await harness.behavior.callRpc("getUsage", {
      force: false,
      machineIds: ["host"],
      providerId: null,
      maxAgeMs: 120_000,
    });
    expect(snapshot).toMatchObject({
      machines: [
        {
          providers: [
            {
              id: "adapter:codex",
              usage: { status: "ok", windows: [{ usedPercent: 42 }] },
            },
          ],
        },
      ],
    });
  } finally {
    await harness.lifecycle.dispose();
  }
});

type FakeRpc = (args: {
  method: string;
  input: { resourceId?: string };
}) => Promise<unknown>;

function freshnessHost(callRpc: FakeRpc, accounts = false) {
  const host = createFakePluginHost({
    pluginId: "provider-usage",
    sdk: {
      system: { config: async () => ({ primaryHostId: null }) },
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", name: "Mac", status: "connected" }),
        ],
      },
      providers: {
        list: async () => [
          { id: "claude-code", displayName: "Claude Code", logoUrl: null },
        ],
      },
      plugins: {
        experimental_discoverRpc: async ({ method = "" } = {}) =>
          method === usageListMethod
            ? [{ pluginId: "pool", displayName: "Pool", method }]
            : accounts
              ? [{ pluginId: "accounts", displayName: "Accounts", method }]
              : [],
        callRpc: vi.fn((args) => callRpc(args as Parameters<FakeRpc>[0])),
      },
    },
  });
  plugin(host.bb);
  return host;
}

function measurement(
  resourceId: string,
  observedAt: number | null,
  usedPercent: number,
) {
  return {
    observedAt,
    usage: {
      status: "ok",
      accountEmail: `${resourceId}@example.com`,
      planLabel: null,
      windows: [
        {
          id: "week",
          label: "Weekly",
          usedPercent,
          resetsAt: null,
          model: null,
          cost: null,
        },
      ],
    },
  };
}

it("carries each measurement's observedAt and never advances it on cached reads or failed refreshes", async () => {
  const failing = new Set<string>();
  let fetches = 0;
  const observed: Record<string, number | null> = { a: 1_000, b: null };
  const host = freshnessHost(async ({ method, input }) => {
    if (method === usageListMethod)
      return {
        label: "Pool",
        resources: ["a", "b"].map((id) => ({
          id,
          providerId: "claude-code",
          label: id,
          scope: { kind: "shared" },
        })),
      };
    fetches += 1;
    if (failing.has(input.resourceId!)) throw new Error("down");
    return measurement(input.resourceId!, observed[input.resourceId!]!, 40);
  });
  const read = async (force: boolean) =>
    (await host.harness.behavior.callRpc("getUsage", {
      force,
      machineIds: ["source:pool"],
      providerId: null,
      maxAgeMs: 60_000,
    })) as UsageSnapshot;
  const providers = async (force: boolean) =>
    (await read(force)).machines.find(
      (machine) => machine.id === "source:pool",
    )!.providers;

  expect(await providers(false)).toMatchObject([
    { id: "pool:a", observedAt: 1_000 },
    { id: "pool:b", observedAt: null },
  ]);
  const afterFirst = fetches;
  observed.a = 9_000;
  expect((await providers(false))[0]).toMatchObject({
    id: "pool:a",
    observedAt: 1_000,
  });
  expect(fetches).toBe(afterFirst);

  failing.add("a");
  const partial = await providers(true);
  expect(partial[0]).toMatchObject({
    id: "pool:a",
    observedAt: 1_000,
    refreshFailed: true,
    usage: { windows: [{ usedPercent: 40 }] },
  });
  expect(partial[1]).toMatchObject({ id: "pool:b", observedAt: null });
  expect(partial[1].refreshFailed).toBeUndefined();

  failing.clear();
  expect((await providers(true))[0]).toMatchObject({ observedAt: 9_000 });
  expect((await providers(true))[0].refreshFailed).toBeUndefined();
});

it("gives merged accounts their own observedAt and never invents a percentage for a hit limit", async () => {
  const host = freshnessHost(async ({ method }) => {
    if (method === usageListMethod)
      return {
        resources: [
          {
            id: "local",
            providerId: "claude-code",
            label: "Claude Code",
            scope: { kind: "host", hostId: "host", hostName: "Mac" },
          },
        ],
      };
    if (method === "accounts.list")
      return [
        {
          id: "local",
          email: "mac@example.com",
          plan: null,
          inUse: true,
          observedAt: 999,
          windows: [],
        },
        {
          id: "measured",
          email: "measured@example.com",
          plan: null,
          inUse: false,
          observedAt: 2_000,
          windows: [{ label: "Weekly", usedPercent: 120, resetsAt: null }],
        },
        {
          id: "limited",
          email: "limited@example.com",
          plan: null,
          inUse: false,
          limitedUntil: 5_000_000_000_000,
          windows: [],
        },
      ];
    return measurement("local", 7_000, 10);
  }, true);
  const snapshot = (await host.harness.behavior.callRpc("getUsage", {
    force: false,
    machineIds: ["host"],
    providerId: null,
    maxAgeMs: 60_000,
  })) as UsageSnapshot;
  const providers = snapshot.machines.find(
    (machine) => machine.id === "host",
  )!.providers;
  expect(providers).toMatchObject([
    { accountId: "local", observedAt: 7_000 },
    {
      accountId: "measured",
      observedAt: 2_000,
      usage: { windows: [{ usedPercent: 120 }] },
    },
    {
      accountId: "limited",
      observedAt: null,
      usage: { windows: [{ label: "Limit hit", usedPercent: null }] },
    },
  ]);
});
