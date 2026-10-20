import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDeps } from "../../src/types.js";

const sandbox = vi.hoisted(() => ({
  checkout: null as string | null,
  offline: false,
  storagePath: "",
}));

vi.mock("../../src/services/hosts/primary-host.js", () => ({
  resolvePrimaryHostId: () => "host_local",
}));
vi.mock("../../src/services/threads/thread-storage.js", () => ({
  requireThreadStoragePath: async () => sandbox.storagePath,
}));
vi.mock("../../src/services/cloudroom/commands.js", () => ({
  cloudroom: () => ({
    threadWorkspace: async () =>
      sandbox.checkout === null ? null : { path: sandbox.checkout, branch: null, head: null },
    threadClient: async () => ({
      runOnVm: async ({ command }: { command: string }) => {
        if (sandbox.offline) throw new Error("sandbox unreachable");
        const result = spawnSync("bash", ["-c", command]);
        return {
          code: result.status ?? 1,
          truncated: false,
          stdout: result.stdout.toString("hex"),
          stderr: result.stderr.toString("hex"),
        };
      },
    }),
  }),
}));

const { cloudFile } = await import("../../src/services/cloudroom/teleport-local.js");
const deps = {} as AppDeps;
let root = "";
let checkout = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cloud-scope-"));
  checkout = join(root, "checkout");
  mkdirSync(join(checkout, "shots"), { recursive: true });
  writeFileSync(join(checkout, "shots", "chart.png"), "inside");
  writeFileSync(join(root, "outside.png"), "outside");
  symlinkSync(join(checkout, "shots", "chart.png"), join(checkout, "internal.png"));
  symlinkSync(join(root, "outside.png"), join(checkout, "escape.png"));
  symlinkSync(root, join(checkout, "parent-link"));
  sandbox.checkout = checkout;
  sandbox.offline = false;
  sandbox.storagePath = join(root, "storage");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const read = (path: string) => cloudFile(deps, "thr_cloud", path, "workspace");

it("reads checkout files and links that stay inside the checkout", async () => {
  expect((await read(join(checkout, "shots", "chart.png"))).toString()).toBe("inside");
  expect((await read(join(checkout, "internal.png"))).toString()).toBe("inside");
});

it.each([
  ["a symlink that leaves the checkout", () => join(checkout, "escape.png")],
  ["a path through a linked parent folder", () => join(checkout, "parent-link", "outside.png")],
  ["traversal out of the checkout", () => join(checkout, "..", "outside.png")],
  ["an absolute path outside the checkout", () => join(root, "outside.png")],
])("rejects %s", async (_label, path) => {
  await expect(read(path())).rejects.toMatchObject({
    status: 403,
    body: { code: "outside_thread_workspace" },
  });
});

it("reports a missing checkout file as missing", async () => {
  await expect(read(join(checkout, "missing.png"))).rejects.toMatchObject({
    status: 404,
    body: { code: "cloud_file_missing" },
  });
});

it("never serves a cached copy for scoped reads", async () => {
  const escape = join(checkout, "escape.png");
  const saved = join(sandbox.storagePath, "Cloud files", escape);
  mkdirSync(dirname(saved), { recursive: true });
  writeFileSync(saved, "outside");

  await expect(read(escape)).rejects.toMatchObject({ status: 403 });
  sandbox.offline = true;
  await expect(read(escape)).rejects.toMatchObject({
    status: 502,
    body: { code: "cloud_sandbox_unavailable" },
  });
});

it("fails closed while the checkout is unknown", async () => {
  sandbox.checkout = null;

  await expect(read(join(root, "checkout", "shots", "chart.png"))).rejects.toMatchObject({
    status: 409,
    body: { code: "cloud_workspace_unavailable" },
  });
});

it("keeps unscoped chat-link reads unchanged", async () => {
  expect((await cloudFile(deps, "thr_cloud", join(checkout, "escape.png"))).toString()).toBe("outside");
});

it("reports an unreadable checkout file clearly", async () => {
  const locked = join(checkout, "locked.png");
  writeFileSync(locked, "secret");
  chmodSync(locked, 0o000);

  await expect(read(locked)).rejects.toMatchObject({
    status: 403,
    body: { code: "cloud_file_unreadable" },
  });
});

it("reports an unreachable sandbox clearly", async () => {
  sandbox.offline = true;

  await expect(read(join(checkout, "shots", "chart.png"))).rejects.toMatchObject({
    status: 502,
    body: { code: "cloud_sandbox_unavailable" },
  });
});
