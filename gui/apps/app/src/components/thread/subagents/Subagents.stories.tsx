import { useState } from "react";
import { makeThreadListEntry } from "../../../../.ladle/story-fixtures";
import {
  buildSubagentTree,
  summarizeSubagents,
  type SubagentCoverage,
  type SubagentEntry,
  type SubagentExecution,
  type SubagentFreshness,
} from "./subagent-model";
import type { SubagentViewProps } from "./SubagentCards";
import { SubagentHeaderChip, SubagentPanelSection } from "./SubagentPanel";

export default { title: "thread/subagents/Info panel" };

const NOW = 1_792_480_000_000;
const MIN = 60_000;
const ROOT = "thr_root";

function child(
  id: string,
  parentThreadId: string,
  overrides: Partial<SubagentEntry> & {
    displayStatus?: SubagentEntry["runtime"]["displayStatus"];
  } = {},
): SubagentEntry {
  const { displayStatus = "idle", ...rest } = overrides;
  return makeThreadListEntry({
    id,
    parentThreadId,
    providerId: "claude-code",
    executionTarget: "cloud",
    status: displayStatus === "host-reconnecting" || displayStatus === "waiting-for-host"
      ? "active"
      : displayStatus === "provisioning"
        ? "starting"
        : displayStatus,
    runtime: { displayStatus, hostReconnectGraceExpiresAt: null },
    createdAt: NOW - 90 * MIN,
    updatedAt: NOW - 3 * MIN,
    ...rest,
  });
}

const MIXED: SubagentEntry[] = [
  child("thr_c1", ROOT, {
    title: "Data sources investigation",
    titleFallback:
      "You are a scoped, READ-ONLY source investigator. Map every client-available fac",
    displayStatus: "active",
    createdAt: NOW - 50 * MIN,
    updatedAt: NOW - 20_000,
  }),
  child("thr_c2", ROOT, {
    title: "Independent review (Sol)",
    titleFallback: "Review the two subagent visibility directions for truth, accessibility, and re",
    displayStatus: "idle",
    hasPendingInteraction: true,
    createdAt: NOW - 45 * MIN,
  }),
  child("thr_g1", "thr_c2", {
    title: "Luna helper: a11y",
    titleFallback: "Check keyboard, screen reader and touch targets.",
    providerId: "codex",
    displayStatus: "active",
    createdAt: NOW - 40 * MIN,
    updatedAt: NOW - MIN,
  }),
  child("thr_g2", "thr_c2", {
    title: "Luna helper: source truth",
    titleFallback: "Verify every status word against server code.",
    providerId: "codex",
    displayStatus: "error",
    createdAt: NOW - 39 * MIN,
  }),
  child("thr_gg1", "thr_g1", {
    title: "Contrast spot-check",
    titleFallback: "Measure text contrast in light and dark.",
    providerId: "codex",
    displayStatus: "idle",
    createdAt: NOW - 30 * MIN,
    updatedAt: NOW - 25 * MIN,
  }),
  child("thr_c3", ROOT, {
    title: "Local build on Mac",
    titleFallback: "Run the desktop build and capture logs.",
    executionTarget: "local",
    displayStatus: "host-reconnecting",
    createdAt: NOW - 30 * MIN,
  }),
  child("thr_c4", ROOT, {
    title: "Migration dry run",
    titleFallback: "Dry-run the migration against a copy of the database.",
    displayStatus: "error",
    queuedWork: "failed",
    createdAt: NOW - 25 * MIN,
    updatedAt: NOW - 12 * MIN,
  }),
  child("thr_c5", ROOT, {
    title: null,
    titleFallback: null,
    executionTarget: undefined,
    providerId: "pi",
    displayStatus: "pending",
    createdAt: NOW - 5 * MIN,
  }),
  child("thr_c6", ROOT, {
    title: "Status freshness check",
    titleFallback: "Confirm what idle means after a turn.",
    displayStatus: "idle",
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 2,
      activePlanModeCount: 0,
      activeGoalCount: 0,
      activeWorkflowCount: 0,
    },
    createdAt: NOW - 4 * MIN,
  }),
];

const EXECUTION: Record<string, SubagentExecution> = {
  thr_c1: { state: "recorded", model: "claude-haiku-5-5", effort: "high" },
  thr_c2: { state: "recorded", model: "gpt-6.1-sol", effort: "medium" },
  thr_g1: { state: "recorded", model: "gpt-6-luna", effort: "high" },
  thr_g2: { state: "unavailable", reason: "couldn’t load" },
  thr_gg1: { state: "loading" },
  thr_c3: { state: "not-recorded" },
  thr_c4: { state: "recorded", model: "claude-opus-5-5[1m]", effort: null },
};

function scenario({
  entries = MIXED,
  coverage = "all-visible" as SubagentCoverage,
  freshness = { state: "live" } as SubagentFreshness,
  listState = "ready" as SubagentViewProps["listState"],
} = {}): SubagentViewProps {
  const roots =
    listState === "ready"
      ? buildSubagentTree(
          ROOT,
          coverage === "direct-only"
            ? entries.filter((entry) => entry.parentThreadId === ROOT)
            : entries,
          coverage,
        )
      : [];
  return {
    roots,
    summary: summarizeSubagents(roots, coverage),
    freshness,
    listState,
    now: NOW,
    useExecution: (entry) => EXECUTION[entry.id] ?? { state: "not-recorded" },
    defaultExpandedIds: EXPANDED,
  };
}

const EXPANDED: ReadonlySet<string> = new Set(["thr_c2", "thr_g1"]);

const PAUSED = scenario({ freshness: { state: "paused", since: NOW - 2 * MIN } });

function Timeline() {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4 text-sm text-muted-foreground">
      <div className="ml-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 text-foreground">
        Improve in-thread subagent visibility. Spawn reviewers.
      </div>
      <p className="text-foreground">Spawned three Haiku investigators and one Sol reviewer…</p>
      <p>Ran room-cli thread spawn ×4</p>
    </div>
  );
}

function Composer() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised-solid px-3 py-3 text-sm text-muted-foreground">
      Ask for follow-up changes
    </div>
  );
}

function InfoTab({ props }: { props: SubagentViewProps }) {
  return (
    <div className="grid gap-1.5 px-4 py-3 text-xs">
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3">
        <span className="text-muted-foreground">Parent</span>
        <span className="text-foreground">CloudRoom root</span>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3">
        <span className="text-muted-foreground">Environment</span>
        <span className="text-foreground">Cloud sandbox</span>
      </div>
      <div className="mb-1 mt-3 border-t border-border" aria-hidden />
      <SubagentPanelSection {...props} />
    </div>
  );
}

function Frame({ width, height, mobile }: { width: number; height: number; mobile?: boolean }) {
  const [open, setOpen] = useState(true);
  const props = scenario();
  const header = (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
      <span className="min-w-0 truncate text-xs text-foreground/70">
        Improve CloudRoom subagent visibility
      </span>
      <span className="rounded-full border border-border px-1.5 text-[11px] leading-4 text-muted-foreground">
        child
      </span>
      <SubagentHeaderChip
        summary={props.summary}
        listState={props.listState}
        freshness={props.freshness}
        isOpen={open}
        onToggle={() => setOpen(!open)}
      />
    </div>
  );
  return (
    <div
      className="relative m-4 flex overflow-hidden rounded-lg border border-border bg-background"
      style={{ width, height }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <Timeline />
        <div className="px-3 pb-3">
          <Composer />
        </div>
      </div>
      {open ? (
        <aside
          className={
            mobile
              ? "absolute inset-x-0 bottom-0 top-11 overflow-y-auto border-t border-border bg-sidebar"
              : "w-[360px] shrink-0 overflow-y-auto border-l border-border bg-sidebar"
          }
        >
          <div className="flex h-9 items-center border-b border-border px-4 text-xs text-foreground">
            Info
          </div>
          <InfoTab props={props} />
        </aside>
      ) : null}
    </div>
  );
}

export function Desktop() {
  return <Frame width={1100} height={780} />;
}

export function Mobile() {
  return <Frame width={390} height={820} mobile />;
}

export function States() {
  const states: [string, SubagentViewProps][] = [
    ["Updates paused (last known)", PAUSED],
    ["Only direct children loaded", scenario({ coverage: "direct-only" })],
    ["Child list failed to load", scenario({ listState: "error" })],
    ["Loading", scenario({ listState: "loading" })],
  ];
  return (
    <div className="grid max-w-[860px] gap-6 p-4">
      {states.map(([label, props]) => (
        <div key={label} className="grid gap-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <div className="flex items-start gap-4">
            <SubagentHeaderChip
              summary={props.summary}
              listState={props.listState}
              freshness={props.freshness}
              isOpen
              onToggle={() => undefined}
            />
            <div className="w-[360px] rounded-md border border-border bg-sidebar">
              <InfoTab props={props} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
