import { Command } from "commander";
import { RECORDED_COMPACTION_GAP_TEXT } from "@cloudroom/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

export function registerContextCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("context [id]")
    .description(
      "Show the latest recorded context window usage, available breakdown, and recorded compactions",
    )
    .option("--self", "Use the current thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: { self?: boolean; json?: boolean },
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const result = await createCliBbSdk(getUrl()).threads.context({
            threadId,
          });
          if (outputJson(opts, result)) return;
          const count = (value: number) => value.toLocaleString("en-US");
          const usage = result.usage;
          if (!usage) {
            console.log(
              result.usageState === "unknown"
                ? "Context usage was not reported by the agent."
                : "Context usage is not available yet.",
            );
          } else {
            console.log(
              `${usage.estimated ? "Estimated context" : "Context window"}: ${count(usage.usedTokens)} / ${count(usage.modelContextWindow)} tokens`,
            );
            if (usage.snapshot) {
              console.log(`Captured: ${usage.snapshot.capturedAt}`);
              for (const category of usage.snapshot.categories) {
                const kind =
                  category.kind === "used" ? "" : ` (${category.kind})`;
                console.log(
                  `${category.label}${kind}: ${count(category.tokens)}`,
                );
                for (const entry of category.entries)
                  console.log(`  ${entry.label}: ${count(entry.tokens)}`);
              }
            }
          }
          const compactions = result.compactions;
          if (!compactions) {
            console.log(
              "Recorded compactions: not available from this server.",
            );
            return;
          }
          console.log(
            `Recorded compactions (whole thread): ${compactions.completedCount}${compactions.coverage === "partial" ? ` (partial history: ${compactions.gaps.map((gap) => RECORDED_COMPACTION_GAP_TEXT[gap]).join(" ")})` : ""}`,
          );
          for (const entry of compactions.entries) {
            if (entry.kind === "clear") {
              console.log(
                `  ${new Date(entry.at).toISOString()} context cleared (not a compaction)`,
              );
              continue;
            }
            const at = entry.completedAt ?? entry.startedAt;
            const label =
              entry.status === "completed"
                ? "compacted"
                : entry.status === "in_progress"
                  ? "compacting (not counted yet)"
                  : "not confirmed (not counted)";
            console.log(
              `  ${at === null ? "time unknown" : new Date(at).toISOString()} ${label}${entry.status === "completed" ? ` - ${entry.summary ?? "Summary not provided."}` : ""}`,
            );
          }
          if (compactions.truncated) console.log("  Showing newest 50.");
        },
      ),
    );
}
