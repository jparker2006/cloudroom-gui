import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const vitestCli = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

describe("retrospective sensitivity of the existing fixture tests", () => {
  it.each([
    [
      "operation receipt",
      "receipt.operationId === state.operationId",
      "true",
      "rejects a receipt for a different operationId",
    ],
    [
      "retry reconciliation",
      'state.phase === "failed" && state.reconciled',
      'state.phase === "failed"',
      "requires a confirmed terminal failure before creating one new retry",
    ],
  ])(
    "detects an injected failure in %s",
    (name, before, after, expectedFailure) => {
      const evidence = mkdtempSync(join(tmpdir(), "onboarding-sensitivity-"));
      const config = join(evidence, "vitest.config.mts");
      writeFileSync(
        config,
        `import base from ${JSON.stringify(join(appRoot, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: "onboarding-retrospective-fault", enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("/dev/onboarding-preview/fixtures.ts")) return;
    if (!code.includes(${JSON.stringify(before)})) throw new Error("Fault target missing");
    return { code: code.replace(${JSON.stringify(before)}, ${JSON.stringify(after)}), map: null };
  }
}] };
`,
      );
      const result = spawnSync(
        process.execPath,
        [
          vitestCli,
          "run",
          "--config",
          config,
          "--maxWorkers=2",
          "src/dev/onboarding-preview/fixtures.test.ts",
        ],
        {
          cwd: appRoot,
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
        },
      );
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      writeFileSync(join(evidence, "result.log"), output);
      writeFileSync(
        join(evidence, "evidence.json"),
        JSON.stringify(
          { name, before, after, expectedFailure, status: result.status },
          null,
          2,
        ),
      );
      expect(result.error, output).toBeUndefined();
      expect(result.status, output).toBe(1);
      expect(output).toContain("AssertionError");
      expect(output).toContain(expectedFailure);
    },
    30_000,
  );
});
