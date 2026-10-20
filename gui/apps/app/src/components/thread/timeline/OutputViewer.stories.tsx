import { useEffect, useMemo, useState } from "react";
import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@cloudroom/shared-ui/button";
import { sdk } from "@/lib/sdk";
import { commandRow, toolRow } from "@/test/fixtures/thread-timeline-rows";
import { WorkRowBody } from "./TimelineRowDetails";
import type { OutputViewerDirection } from "./OutputViewer";
import type { TimelinePreviewableWorkRow } from "./useTimelineWorkRowFullOutput";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow";

const hugeOutput = Array.from(
  { length: 18_000 },
  (_, i) =>
    `${String(i + 1).padStart(5, "0")}  ${i % 211 === 0 ? "\u001b[31mFAIL\u001b[0m" : "\u001b[32mPASS\u001b[0m"}  packages/thread-view · ${i % 211 === 0 ? "search anchor" : "verified"} · café 日本語 👩🏽‍💻`,
).join("\n");
const richOutput = [
  "\u001b[36mCloudRoom / timeline verification\u001b[0m",
  "",
  "\u001b[32mPASS\u001b[0m  Keeps inline previews compact",
  "\u001b[32mPASS\u001b[0m  Preserves nested tool identity",
  "\u001b[31mFAIL\u001b[0m  Search anchor lost after hydration",
  "  expected: retained visible line",
  "  received: jumped to live tail",
  "",
  "\u001b[33mWARN\u001b[0m  Investigate search anchor before shipping",
  "Literal payload: <img src=x onerror=alert(1)> & <script>alert(1)</script>",
  "Unicode: café • 日本語 • Ελληνικά • 👩🏽‍💻 • e\u0301",
  "",
  ...Array.from(
    { length: 220 },
    (_, i) =>
      `${String(i + 1).padStart(4, "0")}  ${i % 19 === 0 ? "FAIL  search anchor" : "PASS  stable timeline"} · duration ${12 + i}ms`,
  ),
  "",
  "1 failed · 222 passed · exit code 1",
].join("\n");
const scenarios = [
  "ANSI + Unicode",
  "Huge output",
  "Long lines",
  "Streaming",
  "Loading",
  "Limited preview",
  "Expired retention",
  "Failed hydration",
  "Nested tool",
] as const;
type Scenario = (typeof scenarios)[number];

function Fixture({
  direction,
  scenario,
}: {
  direction: OutputViewerDirection;
  scenario: Scenario;
}) {
  const [ticks, setTicks] = useState(0);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [recover, setRecover] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [],
  );
  const full =
    scenario === "Huge output"
      ? hugeOutput
      : scenario === "Long lines"
        ? `horizontal-start ${"日本語 · café · 👩🏽‍💻 ".repeat(2500)} horizontal-end\nFAIL search anchor`
        : scenario === "Streaming"
          ? `${richOutput}\n${Array.from({ length: ticks }, (_, i) => `live ${i + 1} · search anchor · café`).join("\n")}`
          : richOutput;
  const preview = `${full.slice(0, 700)}\n…[characters omitted from inline preview]\n${full.slice(-300)}`;
  const row: TimelinePreviewableWorkRow =
    scenario === "Nested tool"
      ? {
          ...toolRow({
            id: "nested-tool",
            callId: "repeated-call",
            threadId: "child-thread",
            toolName: "functions.exec",
            toolArgs: { command: "pnpm test", parent: "delegated QA" },
            output: preview,
          }),
          outputPreview: {
            totalChars: full.length,
            experimental_fullOutputAvailability: "available",
          },
        }
      : {
          ...commandRow({
            id: "output-candidate",
            command: "pnpm exec turbo run test --filter=@cloudroom/thread-view",
            output: scenario === "Streaming" ? full : preview,
            status:
              scenario === "Streaming" && !completed ? "pending" : "completed",
            exitCode: scenario === "Streaming" && !completed ? null : 1,
            threadId: "output-fixture",
          }),
          ...(scenario === "Streaming"
            ? {}
            : {
                outputPreview: {
                  totalChars: full.length,
                  experimental_fullOutputAvailability:
                    scenario === "Expired retention"
                      ? ("retention-expired" as const)
                      : ("available" as const),
                },
              }),
        };
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTicks((value) => value + 1), 180);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const original = sdk.threads.timelineTurnSummaryDetails;
    sdk.threads.timelineTurnSummaryDetails = async () => {
      setAttempts((value) => value + 1);
      await new Promise((resolve) =>
        window.setTimeout(resolve, scenario === "Loading" ? 6000 : 550),
      );
      if (scenario === "Failed hydration" && !recover)
        throw new Error("Fixture: retained-output request failed");
      const detail = {
        ...row,
        output: scenario === "Limited preview" ? preview : full,
        outputPreview:
          scenario === "Limited preview"
            ? {
                totalChars: full.length,
                experimental_fullOutputAvailability: "detail-limit" as const,
              }
            : undefined,
      };
      return {
        rows:
          scenario === "Nested tool"
            ? [
                toolRow({
                  callId: row.callId,
                  threadId: "wrong-parent",
                  output: "WRONG nested output",
                }),
                detail,
              ]
            : [detail],
      };
    };
    return () => {
      sdk.threads.timelineTurnSummaryDetails = original;
    };
  }, [scenario, recover, full]);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Fixture controls · requests: {attempts}</span>
        {scenario === "Streaming" ? (
          <>
            <Button
              variant="outline"
              onClick={() => setRunning((value) => !value)}
            >
              {running ? "Pause stream" : "Start stream"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRunning(false);
                setCompleted(true);
              }}
            >
              Complete command
            </Button>
          </>
        ) : null}
        {scenario === "Failed hydration" ? (
          <Button
            variant="outline"
            onClick={() => setRecover((value) => !value)}
          >
            {recover ? "Retry will succeed" : "Allow retry to succeed"}
          </Button>
        ) : null}
      </div>
      <div data-fixture-thread className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl bg-muted/40 px-5 py-4 text-sm">
          Check timeline stability and investigate the failed search anchor
          test.
        </div>
        <p className="text-sm leading-6">
          I ran the timeline suite. One reading-position test failed. Open the
          output to inspect the loaded text.
        </p>
        <ExpandableTimelineRow
          title={{
            segments: [],
            decorations: [],
            tone: "default",
            action: null,
            plain: "Ran timeline verification",
          }}
          titleContent="Ran timeline verification"
          autoExpanded
          renderBody={() => (
            <WorkRowBody
              row={row}
              workspaceRootPath={undefined}
              outputViewerDirection={
                direction === "indexed" ? "indexed" : undefined
              }
            />
          )}
        />
        <p className="text-sm text-muted-foreground">
          The thread stays in place while the output drawer is open.
        </p>
      </div>
    </QueryClientProvider>
  );
}

function Direction({
  direction,
  selected = false,
}: {
  direction: OutputViewerDirection;
  selected?: boolean;
}) {
  const [scenario, setScenario] = useState<Scenario>("ANSI + Unicode");
  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-10">
      <div className="mb-8 border-b pb-5">
        <div className="mb-2 flex items-center gap-3">
          <span className="rounded-md border px-2 py-1 text-xs">CloudRoom</span>
          <span className="text-xs text-muted-foreground">
            {selected
              ? "Reader selected · implementation review"
              : "Design review · no rollout"}
          </span>
        </div>
        <h1 className="text-2xl font-semibold">
          {selected
            ? "Output reader"
            : direction === "reader"
              ? "A · Focused reader"
              : "B · Indexed investigation"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {direction === "reader"
            ? "A quiet reading surface. Search and navigate without leaving the output."
            : "Matching-line navigation beside the output. More context, less reading width."}
        </p>
        <label className="mt-5 flex items-center gap-3 text-sm">
          Scenario
          <select
            aria-label="Output scenario"
            className="h-11 max-w-52 rounded-md border bg-background px-3"
            value={scenario}
            onChange={(event) => setScenario(event.target.value as Scenario)}
          >
            {scenarios.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <Fixture key={scenario} direction={direction} scenario={scenario} />
    </main>
  );
}

export const FocusedReader: Story = () => <Direction direction="reader" />;
export const MatchIndex: Story = () => <Direction direction="indexed" />;
export const SelectedReader: Story = () => (
  <Direction direction="reader" selected />
);
export default { title: "Thread / Output viewer candidates" };
