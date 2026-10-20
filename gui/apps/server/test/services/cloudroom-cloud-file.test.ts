import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDeps } from "../../src/types.js";

const cloud = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  lookupError: null as Error | null,
  offline: false,
  storagePath: "",
}));

vi.mock("../../src/services/hosts/primary-host.js", () => ({
  resolvePrimaryHostId: () => "host_local",
}));
vi.mock("../../src/services/threads/thread-storage.js", () => ({
  requireThreadStoragePath: async () => cloud.storagePath,
}));
vi.mock("../../src/services/cloudroom/commands.js", () => ({
  cloudroom: () => ({
    threadClient: async () => {
      if (cloud.lookupError) throw cloud.lookupError;
      return {
        runOnVm: async ({ command }: { command: string }) => {
          if (cloud.offline) throw new Error("sandbox unreachable");
          const path = /'([^']+)'/u.exec(command)?.[1] ?? "";
          const data = cloud.files.get(path);
          const stdout = command.startsWith("[ -f")
            ? Buffer.from(`${data?.length ?? -1}\n`)
            : (data ?? Buffer.alloc(0));
          return { code: 0, truncated: false, stdout: stdout.toString("hex"), stderr: "" };
        },
      };
    },
  }),
}));

const { cloudFile } = await import("../../src/services/cloudroom/teleport-local.js");
const { ApiError } = await import("../../src/errors.js");
const deps = {} as AppDeps;
const path = "/code/app/shots/chart.png";

beforeEach(() => {
  cloud.storagePath = mkdtempSync(join(tmpdir(), "cloud-file-"));
  cloud.files.clear();
  cloud.offline = false;
  cloud.lookupError = null;
});

afterEach(() => {
  rmSync(cloud.storagePath, { recursive: true, force: true });
});

function cacheOldCopy(): void {
  const saved = join(cloud.storagePath, "Cloud files", path);
  mkdirSync(dirname(saved), { recursive: true });
  writeFileSync(saved, "old");
}

it("returns the live cloud file and replaces an older cached copy", async () => {
  cacheOldCopy();
  cloud.files.set(path, Buffer.from("new"));

  expect((await cloudFile(deps, "thr_cloud", path)).toString()).toBe("new");
  cloud.offline = true;
  expect((await cloudFile(deps, "thr_cloud", path)).toString()).toBe("new");
});

it("reports a file the sandbox says is missing even when a cached copy exists", async () => {
  cacheOldCopy();

  await expect(cloudFile(deps, "thr_cloud", path)).rejects.toMatchObject({
    status: 404,
    body: { code: "cloud_file_missing" },
  });
});

it("reports a missing file when nothing is cached", async () => {
  await expect(cloudFile(deps, "thr_cloud", path)).rejects.toMatchObject({
    status: 404,
  });
});

it("still serves the cached copy while the sandbox is unreachable", async () => {
  cacheOldCopy();
  cloud.offline = true;

  expect((await cloudFile(deps, "thr_cloud", path)).toString()).toBe("old");
});

it("keeps the cached copy for other 404s that are not a missing cloud file", async () => {
  cacheOldCopy();
  cloud.lookupError = new ApiError(404, "thread_not_found", "No sandbox binding.");

  expect((await cloudFile(deps, "thr_cloud", path)).toString()).toBe("old");
});
