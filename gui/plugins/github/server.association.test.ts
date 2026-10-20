import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import plugin, { type githubRpcContract } from "./server";

type Association = PluginRpcResult<(typeof githubRpcContract)["pullForThread"]>;
type FetchedPull = PluginRpcResult<(typeof githubRpcContract)["getPull"]>;

let binDir: string;
const originalPath = process.env.PATH;

function pullView(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `PR_node_${number}`,
    number,
    title: `PR ${number}`,
    state: "OPEN",
    isDraft: false,
    author: { login: "octocat" },
    body: "",
    url: `https://github.com/acme/widgets/pull/${number}`,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
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
    statusCheckRollup: [],
    comments: [],
    reviews: [],
    ...overrides,
  };
}

function writeGh(views: Record<string, unknown>, failing: string[] = []) {
  const cases = Object.entries(views)
    .map(
      ([number, view]) =>
        `  "pr view ${number} -R acme/widgets --json"*) printf '%s\\n' '${JSON.stringify(view)}';;`,
    )
    .join("\n");
  const failures = failing
    .map(
      (number) =>
        `  "pr view ${number} -R acme/widgets --json"*) echo "GraphQL: Could not resolve to a PullRequest with the number of ${number}." >&2; exit 1;;`,
    )
    .join("\n");
  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env bash
case "$*" in
  "--version") echo "gh version 2.96.0 (fake)";;
  "auth status --hostname github.com --active") echo "authenticated";;
${failures}
${cases}
  "api --paginate --slurp "*) printf '%s\\n' '[[]]';;
  *) printf '%s\\n' '[]';;
esac
`,
  );
  chmodSync(join(binDir, "gh"), 0o755);
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "bb-github-assoc-"));
  writeGh({ 42: pullView(42), 43: pullView(43), 39: pullView(39) });
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(binDir, { recursive: true, force: true });
});

type PullRequestOutcome =
  | { outcome: "available"; pullRequest: { number: number; url: string } }
  | { outcome: "absent" }
  | { outcome: "unavailable"; message: string };

interface World {
  environments: Record<string, string | null>;
  workspace: Record<string, PullRequestOutcome | Error>;
  spawned: number;
}

function newWorld(): World {
  return { environments: {}, workspace: {}, spawned: 0 };
}

function workspacePull(number: number): PullRequestOutcome {
  return {
    outcome: "available",
    pullRequest: {
      number,
      url: `https://github.com/acme/widgets/pull/${number}`,
    },
  };
}

async function loadPlugin(world: World) {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: { extraRepos: "acme/widgets", defaultProject: "proj-1" },
    sdk: {
      projects: { list: async () => [] },
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (!(threadId in world.environments)) {
            throw new Error(`HTTP 404: thread ${threadId} not found`);
          }
          return { id: threadId, environmentId: world.environments[threadId] };
        },
        spawn: async () => ({ id: `thr_spawned_${++world.spawned}` }),
      },
      environments: {
        pullRequest: async ({ environmentId }: { environmentId: string }) => {
          const result = world.workspace[environmentId] ?? {
            outcome: "absent",
          };
          if (result instanceof Error) throw result;
          return result;
        },
      },
    } as never,
  });
  await plugin(host.bb);
  return host;
}

async function fetchShape(host: Awaited<ReturnType<typeof loadPlugin>>) {
  return (
    (await host.harness.callRpc("getPull", {
      repo: "acme/widgets",
      number: 42,
    })) as FetchedPull
  ).pull;
}

async function addReviewLink(
  host: Awaited<ReturnType<typeof loadPlugin>>,
  number: number,
  threadId: string,
) {
  const key = `link:pr:acme/widgets#${number}`;
  const existing = (await host.bb.storage.kv.get<unknown[]>(key)) ?? [];
  await host.bb.storage.kv.set(key, [
    ...existing,
    {
      kind: "pr",
      repo: "acme/widgets",
      number,
      threadId,
      createdAt: "2026-10-01T00:00:00Z",
    },
  ]);
}

describe("pullForThread association", () => {
  it("shows a single workspace-branch candidate with its provenance", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = workspacePull(42);
    const { harness } = await loadPlugin(world);

    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      environmentId: "env-a",
      selection: null,
      resolution: {
        kind: "candidate",
        repo: "acme/widgets",
        number: 42,
        sources: ["workspace"],
      },
    });
  });

  it("merges a review link for the same PR into one candidate", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = workspacePull(42);
    const host = await loadPlugin(world);
    await addReviewLink(host, 42, "thr_a");

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      resolution: {
        kind: "candidate",
        number: 42,
        sources: ["workspace", "review"],
      },
    });
  });

  it("requires a choice when workspace and review links disagree", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = workspacePull(42);
    const host = await loadPlugin(world);
    await addReviewLink(host, 39, "thr_a");

    const result = (await host.harness.callRpc("pullForThread", {
      threadId: "thr_a",
    })) as Association;
    expect(result.resolution).toEqual({ kind: "ambiguous" });
    expect(result.candidates).toEqual([
      { repo: "acme/widgets", number: 42, id: null, sources: ["workspace"] },
      { repo: "acme/widgets", number: 39, id: null, sources: ["review"] },
    ]);
  });

  it("requires a choice for several review links instead of taking the first", async () => {
    const world = newWorld();
    world.environments.thr_a = null;
    const host = await loadPlugin(world);
    await addReviewLink(host, 39, "thr_a");
    await addReviewLink(host, 43, "thr_a");
    await addReviewLink(host, 42, "thr_other");

    const result = (await host.harness.callRpc("pullForThread", {
      threadId: "thr_a",
    })) as Association;
    expect(result.resolution).toEqual({ kind: "ambiguous" });
    expect(
      result.candidates.map((candidate) => candidate.number).sort(),
    ).toEqual([39, 43]);
  });

  it("reports a confirmed no-match only when every lookup succeeded", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = { outcome: "absent" };
    const { harness } = await loadPlugin(world);

    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [],
      failures: [],
      resolution: { kind: "none" },
    });
  });

  it("does not collapse lookup errors into 'no pull request'", async () => {
    const world = newWorld();
    world.environments.thr_auth = "env-auth";
    world.workspace["env-auth"] = {
      outcome: "unavailable",
      message:
        "gh pr view failed: To get started with GitHub CLI, please run: gh auth login",
    };
    world.environments.thr_down = "env-down";
    world.workspace["env-down"] = {
      outcome: "unavailable",
      message: "gh pr view failed: HTTP 502 Bad Gateway",
    };
    world.environments.thr_throw = "env-throw";
    world.workspace["env-throw"] = new Error("environment request failed");
    const { harness } = await loadPlugin(world);

    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_auth" }),
    ).resolves.toMatchObject({
      resolution: { kind: "failed", reason: "auth" },
    });
    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_down" }),
    ).resolves.toMatchObject({
      resolution: { kind: "failed", reason: "unavailable" },
    });
    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_throw" }),
    ).resolves.toMatchObject({
      resolution: {
        kind: "failed",
        reason: "lookup",
        message: "environment request failed",
      },
    });
    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_missing" }),
    ).resolves.toMatchObject({
      resolution: { kind: "failed", reason: "lookup" },
    });
  });

  it("offers partial candidates after a failure without auto-showing them", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = {
      outcome: "unavailable",
      message: "workspace offline",
    };
    const host = await loadPlugin(world);
    await addReviewLink(host, 39, "thr_a");

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [{ number: 39, sources: ["review"] }],
      resolution: { kind: "failed", reason: "unavailable" },
    });
  });

  it("rejects a workspace PR URL that does not match its number", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = {
      outcome: "available",
      pullRequest: {
        number: 42,
        url: "https://github.com/acme/widgets/pull/43",
      },
    };
    const { harness } = await loadPlugin(world);

    await expect(
      harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [],
      resolution: { kind: "failed", reason: "lookup" },
    });
  });
});

describe("review link identity", () => {
  it("records the GitHub id when a review starts and carries it to the candidate", async () => {
    const world = newWorld();
    const host = await loadPlugin(world);
    const { threadId } = (await host.harness.callRpc("startReview", {
      repo: "acme/widgets",
      number: 42,
    })) as { threadId: string };
    world.environments[threadId] = null;

    expect(
      await host.bb.storage.kv.get("link:pr:acme/widgets#42"),
    ).toMatchObject([{ threadId, pullId: "PR_node_42" }]);
    await expect(
      host.harness.callRpc("pullForThread", { threadId }),
    ).resolves.toMatchObject({
      resolution: {
        kind: "candidate",
        number: 42,
        id: "PR_node_42",
        sources: ["review"],
      },
    });
  });

  it("merges a renamed workspace PR with an old-name review link for the same id", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = {
      outcome: "available",
      pullRequest: {
        number: 42,
        url: "https://github.com/acme/renamed/pull/42",
      },
    };
    writeFileSync(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
case "$*" in
  "--version") echo "gh version 2.96.0 (fake)";;
  "auth status --hostname github.com --active") echo "authenticated";;
  "pr view 42 -R acme/renamed --json id") printf '%s\\n' '{"id":"PR_node_42"}';;
  *) printf '%s\\n' '[]';;
esac
`,
    );
    chmodSync(join(binDir, "gh"), 0o755);
    const host = await loadPlugin(world);
    await host.bb.storage.kv.set("link:pr:acme/widgets#42", [
      {
        kind: "pr",
        repo: "acme/widgets",
        number: 42,
        threadId: "thr_a",
        createdAt: "2026-10-01T00:00:00Z",
        pullId: "PR_node_42",
      },
    ]);

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [
        {
          repo: "acme/renamed",
          number: 42,
          id: "PR_node_42",
          sources: ["workspace", "review"],
        },
      ],
      resolution: { kind: "candidate", repo: "acme/renamed", id: "PR_node_42" },
    });
  });

  it("keeps renamed matches separate when their identity can't be confirmed", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = {
      outcome: "available",
      pullRequest: {
        number: 42,
        url: "https://github.com/acme/renamed/pull/42",
      },
    };
    writeGh({}, ["42"]);
    const host = await loadPlugin(world);
    await host.bb.storage.kv.set("link:pr:acme/widgets#42", [
      {
        kind: "pr",
        repo: "acme/widgets",
        number: 42,
        threadId: "thr_a",
        createdAt: "2026-10-01T00:00:00Z",
        pullId: "PR_node_42",
      },
    ]);

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [
        { repo: "acme/renamed", id: null },
        { repo: "acme/widgets", id: "PR_node_42" },
      ],
      resolution: { kind: "ambiguous" },
    });
  });

  it("does not auto-show a legacy review link without an id", async () => {
    const world = newWorld();
    world.environments.thr_a = null;
    const host = await loadPlugin(world);
    await addReviewLink(host, 39, "thr_a");

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      candidates: [{ number: 39, id: null, sources: ["review"] }],
      resolution: { kind: "ambiguous" },
    });
  });
});

describe("explicit pull request selection", () => {
  const selection = (
    host: Awaited<ReturnType<typeof loadPlugin>>,
    threadId: string,
  ) => host.bb.storage.kv.get(`selection:${threadId}`);

  it("persists, survives a reload, changes, and clears per thread", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.environments.thr_b = "env-b";
    world.workspace["env-a"] = workspacePull(42);
    world.workspace["env-b"] = workspacePull(42);
    const first = await loadPlugin(world);

    const selected = (await first.harness.callRpc("setPullForThread", {
      threadId: "thr_a",
      pull: { repo: "acme/widgets", number: 43 },
    })) as Association;
    expect(selected.resolution).toEqual({
      kind: "selected",
      repo: "acme/widgets",
      number: 43,
    });
    expect(selected.selection).toMatchObject({
      repo: "acme/widgets",
      number: 43,
      id: "PR_node_43",
    });
    expect(selected.candidates).toEqual([
      { repo: "acme/widgets", number: 42, id: null, sources: ["workspace"] },
    ]);
    expect(
      first.harness.realtimeSignals.filter(
        (signal) => signal.channel === "association-changed",
      ),
    ).toHaveLength(1);

    const reloaded = await first.harness.reload(plugin);
    await expect(
      reloaded.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      resolution: { kind: "selected", number: 43 },
    });
    await expect(
      reloaded.harness.callRpc("pullForThread", { threadId: "thr_b" }),
    ).resolves.toMatchObject({
      selection: null,
      resolution: { kind: "candidate", number: 42 },
    });

    await expect(
      reloaded.harness.callRpc("setPullForThread", {
        threadId: "thr_a",
        pull: { repo: "acme/widgets", number: 39 },
      }),
    ).resolves.toMatchObject({ resolution: { kind: "selected", number: 39 } });

    await expect(
      reloaded.harness.callRpc("setPullForThread", {
        threadId: "thr_a",
        pull: null,
      }),
    ).resolves.toMatchObject({
      selection: null,
      resolution: { kind: "candidate", number: 42, sources: ["workspace"] },
    });
    expect(await selection(reloaded, "thr_a")).toBeUndefined();
  });

  it("keeps the explicit choice even when lookups fail", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = { outcome: "unavailable", message: "HTTP 503" };
    const host = await loadPlugin(world);
    await host.bb.storage.kv.set("selection:thr_a", {
      repo: "acme/widgets",
      number: 43,
      id: "PR_node_43",
      selectedAt: "2026-10-01T00:00:00Z",
    });

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      failures: [{ source: "workspace", reason: "unavailable" }],
      resolution: { kind: "selected", number: 43 },
    });
  });

  it("ignores agent-writable thread metadata", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = workspacePull(42);
    const host = await loadPlugin(world);
    host.harness.sdk.stub("threads.getPluginMetadata", () => ({
      prAssociation: {
        repo: "victim/x",
        number: 9,
        id: "x",
        selectedAt: "now",
      },
    }));

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      selection: null,
      resolution: { kind: "candidate", number: 42 },
    });
  });

  it("refuses a PR GitHub cannot confirm and leaves the saved choice alone", async () => {
    writeGh({ 42: pullView(42) }, ["404"]);
    const world = newWorld();
    world.environments.thr_a = null;
    const host = await loadPlugin(world);
    await host.harness.callRpc("setPullForThread", {
      threadId: "thr_a",
      pull: { repo: "acme/widgets", number: 42 },
    });

    await expect(
      host.harness.callRpc("setPullForThread", {
        threadId: "thr_a",
        pull: { repo: "acme/widgets", number: 404 },
      }),
    ).rejects.toThrow(/was not found, or this GitHub account cannot read it/);
    expect(await selection(host, "thr_a")).toMatchObject({ number: 42 });
  });

  it("refuses to save a choice for an unknown thread", async () => {
    const host = await loadPlugin(newWorld());

    await expect(
      host.harness.callRpc("setPullForThread", {
        threadId: "thr_gone",
        pull: { repo: "acme/widgets", number: 42 },
      }),
    ).rejects.toThrow(/not found/);
    expect(await selection(host, "thr_gone")).toBeUndefined();
  });

  it("rejects a repository redirect instead of silently saving another repo", async () => {
    writeGh({
      50: pullView(50, { url: "https://github.com/acme/renamed/pull/50" }),
    });
    const world = newWorld();
    world.environments.thr_a = null;
    const host = await loadPlugin(world);

    await expect(
      host.harness.callRpc("setPullForThread", {
        threadId: "thr_a",
        pull: { repo: "acme/widgets", number: 50 },
      }),
    ).rejects.toThrow("Choose acme/renamed#50 instead.");
    expect(await selection(host, "thr_a")).toBeUndefined();
  });

  it("applies association writes in request order", async () => {
    writeFileSync(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
case "$*" in
  "--version") echo "gh version 2.96.0 (fake)";;
  "auth status --hostname github.com --active") echo "authenticated";;
  "pr view 43 -R acme/widgets --json id,number,url") sleep 1; printf '%s\\n' '{"id":"PR_node_43","number":43,"url":"https://github.com/acme/widgets/pull/43"}';;
  *) printf '%s\\n' '[]';;
esac
`,
    );
    chmodSync(join(binDir, "gh"), 0o755);
    const world = newWorld();
    world.environments.thr_a = null;
    const host = await loadPlugin(world);

    const slowSelect = host.harness.callRpc("setPullForThread", {
      threadId: "thr_a",
      pull: { repo: "acme/widgets", number: 43 },
    });
    const clear = host.harness.callRpc("setPullForThread", {
      threadId: "thr_a",
      pull: null,
    });
    await Promise.all([slowSelect, clear]);

    expect(await selection(host, "thr_a")).toBeUndefined();
  });

  it("treats an unreadable saved choice as a failure, not a candidate", async () => {
    const world = newWorld();
    world.environments.thr_a = "env-a";
    world.workspace["env-a"] = workspacePull(42);
    const host = await loadPlugin(world);
    await host.bb.storage.kv.set("selection:thr_a", { repo: "nope" });

    await expect(
      host.harness.callRpc("pullForThread", { threadId: "thr_a" }),
    ).resolves.toMatchObject({
      selection: null,
      candidates: [{ number: 42 }],
      resolution: { kind: "failed", reason: "lookup" },
    });
  });

  it("keeps every review link when reviews start concurrently", async () => {
    const world = newWorld();
    const host = await loadPlugin(world);

    await Promise.all([
      host.harness.callRpc("startReview", { repo: "acme/widgets", number: 42 }),
      host.harness.callRpc("startReview", { repo: "acme/widgets", number: 42 }),
    ]);

    expect(
      await host.bb.storage.kv.get<unknown[]>("link:pr:acme/widgets#42"),
    ).toHaveLength(2);
  });
});

describe("pull detail cache and checks truth", () => {
  it("serves the last successful fetch and keeps it when a refresh fails", async () => {
    const world = newWorld();
    const { harness } = await loadPlugin(world);

    await expect(
      harness.callRpc("cachedPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toEqual({ cached: null });
    const fresh = (await harness.callRpc("getPull", {
      repo: "acme/widgets",
      number: 42,
    })) as FetchedPull;
    expect(Date.parse(fresh.fetchedAt)).not.toBeNaN();
    expect(fresh.fetchedAt).not.toBe(fresh.pull.updatedAt);

    writeGh({}, ["42"]);
    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).rejects.toThrow();
    await expect(
      harness.callRpc("cachedPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toEqual({ cached: fresh });
  });

  it("never reports unknown or absent checks as passing", async () => {
    writeGh({
      42: pullView(42, { statusCheckRollup: undefined }),
      43: pullView(43, {
        statusCheckRollup: [
          { name: "cancelled", status: "COMPLETED", conclusion: "CANCELLED" },
          { name: "odd", status: "COMPLETED", conclusion: "SOMETHING_NEW" },
          { name: "empty", status: "COMPLETED", conclusion: "" },
          { context: "legacy", state: "PENDING" },
        ],
      }),
    });
    const { harness } = await loadPlugin(newWorld());

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({ pull: { checks: null } });
    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 43 }),
    ).resolves.toMatchObject({
      pull: {
        checks: [
          { name: "cancelled", status: "failure" },
          { name: "odd", status: "unknown" },
          { name: "empty", status: "unknown" },
          { name: "legacy", status: "pending" },
        ],
      },
    });
  });

  it("keeps newer cached detail when an older refresh finishes last", async () => {
    const host = await loadPlugin(newWorld());
    await host.bb.storage.kv.set("pull-detail:acme/widgets#42", {
      pull: { ...(await fetchShape(host)), title: "newer" },
      fetchedAt: "2999-01-01T00:00:00.000Z",
    });

    await host.harness.callRpc("getPull", { repo: "acme/widgets", number: 42 });

    await expect(
      host.harness.callRpc("cachedPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({ cached: { pull: { title: "newer" } } });
  });

  it("orders overlapping cache writes by fetch start", async () => {
    writeFileSync(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
case "$*" in
  "--version") echo "gh version 2.96.0 (fake)";;
  "auth status --hostname github.com --active") echo "authenticated";;
  "pr view 42 -R acme/widgets --json"*) if [ -f "${binDir}/second" ]; then printf '%s\\n' '${JSON.stringify(pullView(42, { title: "newer" }))}'; else touch "${binDir}/second"; sleep 0.4; printf '%s\\n' '${JSON.stringify(pullView(42, { title: "older" }))}'; fi;;
  "api --paginate --slurp "*) printf '%s\\n' '[[]]';;
  *) printf '%s\\n' '[]';;
esac
`,
    );
    chmodSync(join(binDir, "gh"), 0o755);
    const host = await loadPlugin(newWorld());
    const kv = host.bb.storage.kv;
    const realGet = kv.get.bind(kv);
    kv.get = (async (key: string) => {
      const snapshot = await realGet(key);
      if (key.startsWith("pull-detail:")) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return snapshot;
    }) as typeof kv.get;

    const older = host.harness.callRpc("getPull", {
      repo: "acme/widgets",
      number: 42,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newer = host.harness.callRpc("getPull", {
      repo: "acme/widgets",
      number: 42,
    });
    await Promise.all([older, newer]);

    await expect(
      host.harness.callRpc("cachedPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({ cached: { pull: { title: "newer" } } });
  });

  it("gives every fetch a distinct, increasing start time", async () => {
    const host = await loadPlugin(newWorld());
    const results = (await Promise.all(
      [1, 2, 3].map(() =>
        host.harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
      ),
    )) as FetchedPull[];
    const stamps = results.map((result) => result.fetchedAt);

    expect(new Set(stamps).size).toBe(3);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("returns fresh detail even when the cache cannot be read", async () => {
    const host = await loadPlugin(newWorld());
    host.bb.storage.kv.get = (async () => {
      throw new Error("kv offline");
    }) as typeof host.bb.storage.kv.get;

    await expect(
      host.harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({ pull: { number: 42 } });
  });

  it("labels detail with the repository GitHub reports", async () => {
    writeGh({
      42: pullView(42, { url: "https://github.com/acme/renamed/pull/42" }),
    });
    const { harness } = await loadPlugin(newWorld());

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({ pull: { repo: "acme/renamed", number: 42 } });
  });

  it("caches without file patches and skips detail too large for storage", async () => {
    writeGh({
      42: pullView(42),
      43: pullView(43, { body: "x".repeat(250_000) }),
    });
    const host = await loadPlugin(newWorld());

    const fresh = (await host.harness.callRpc("getPull", {
      repo: "acme/widgets",
      number: 43,
    })) as FetchedPull;
    expect(fresh.pull.body).toHaveLength(250_000);
    await expect(
      host.harness.callRpc("cachedPull", { repo: "acme/widgets", number: 43 }),
    ).resolves.toEqual({ cached: null });
  });

  it("uses the latest run of each check and treats stale results as failing", async () => {
    writeGh({
      42: pullView(42, {
        statusCheckRollup: [
          {
            name: "test",
            status: "COMPLETED",
            conclusion: "FAILURE",
            startedAt: "2026-10-01T00:00:00Z",
          },
          {
            name: "test",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            startedAt: "2026-10-01T01:00:00Z",
          },
          {
            name: "old",
            status: "COMPLETED",
            conclusion: "STALE",
            startedAt: "2026-10-01T00:00:00Z",
          },
        ],
      }),
    });
    const { harness } = await loadPlugin(newWorld());

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({
      pull: {
        checks: [
          { name: "test", status: "success" },
          { name: "old", status: "failure" },
        ],
      },
    });
  });

  it("refuses detail that GitHub reports for a different number", async () => {
    writeGh({ 42: pullView(43) });
    const { harness } = await loadPlugin(newWorld());

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).rejects.toThrow(/refusing to show a different pull request/);
    await expect(
      harness.callRpc("cachedPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toEqual({ cached: null });
  });

  it("maps draft, merged, and closed states", async () => {
    writeGh({
      42: pullView(42, { isDraft: true }),
      43: pullView(43, { state: "MERGED" }),
      39: pullView(39, { state: "CLOSED" }),
    });
    const { harness } = await loadPlugin(newWorld());
    const state = async (number: number) =>
      (
        (await harness.callRpc("getPull", {
          repo: "acme/widgets",
          number,
        })) as FetchedPull
      ).pull.state;

    expect(await state(42)).toBe("DRAFT");
    expect(await state(43)).toBe("MERGED");
    expect(await state(39)).toBe("CLOSED");
  });
});
