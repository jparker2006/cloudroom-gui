import type {
  ThreadListEntry,
  ThreadRuntimeDisplayStatus,
} from "@cloudroom/domain";
import { isRunningThreadRuntimeDisplayStatus } from "@cloudroom/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export type SubagentEntry = Pick<
  ThreadListEntry,
  | "id"
  | "projectId"
  | "parentThreadId"
  | "title"
  | "titleFallback"
  | "status"
  | "runtime"
  | "activity"
  | "queuedWork"
  | "hasPendingInteraction"
  | "providerId"
  | "executionTarget"
  | "createdAt"
  | "updatedAt"
>;

export interface SubagentNode {
  entry: SubagentEntry;
  children: SubagentNode[];
  descendantCount: number | null;
}

export type SubagentTone = "working" | "attention" | "error" | "neutral";

export interface SubagentStatus {
  tone: SubagentTone;
  label: string;
  detail: string;
  running: boolean;
}

export interface SubagentFlag {
  kind: "needs-input" | "background" | "queued-failed" | "queued-waiting";
  label: string;
}

export type SubagentBucket =
  | "working"
  | "needs-input"
  | "failed"
  | "host"
  | "not-started"
  | "idle";

export type SubagentCoverage = "all-visible" | "direct-only";

export interface SubagentSummary {
  directCount: number;
  nestedCount: number | null;
  buckets: Record<SubagentBucket, number>;
}

export type SubagentExecution =
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  | { state: "not-recorded" }
  | { state: "recorded"; model: string; effort: string | null };

export type SubagentFreshness =
  | { state: "live" }
  | { state: "paused"; since: number | null };

const STATUS_COPY: Record<
  ThreadRuntimeDisplayStatus,
  Omit<SubagentStatus, "running">
> = {
  active: {
    tone: "working",
    label: "Active",
    detail: "Recorded as active · may include a message not yet delivered",
  },
  starting: { tone: "working", label: "Starting", detail: "Recorded as starting" },
  provisioning: {
    tone: "working",
    label: "Provisioning",
    detail: "Recorded as preparing its workspace",
  },
  stopping: { tone: "working", label: "Stopping", detail: "Recorded as stopping" },
  "host-reconnecting": {
    tone: "attention",
    label: "Host reconnecting",
    detail: "Recorded as active; its host link dropped",
  },
  "waiting-for-host": {
    tone: "attention",
    label: "Waiting for host",
    detail: "Recorded as active; its host is offline",
  },
  pending: {
    tone: "neutral",
    label: "Pending",
    detail: "Recorded as pending · may be waiting for setup or files",
  },
  error: {
    tone: "error",
    label: "Error",
    detail: "Recorded as error · cause not shown here",
  },
  idle: {
    tone: "neutral",
    label: "Idle",
    detail: "Not recorded as active · outcome not recorded here",
  },
};

export function getSubagentStatus(entry: SubagentEntry): SubagentStatus {
  const status = entry.runtime.displayStatus;
  return {
    ...STATUS_COPY[status],
    running: isRunningThreadRuntimeDisplayStatus(status),
  };
}

export function getSubagentFlags(entry: SubagentEntry): SubagentFlag[] {
  const flags: SubagentFlag[] = [];
  if (entry.hasPendingInteraction) {
    flags.push({ kind: "needs-input", label: "Needs input" });
  }
  const { activeBackgroundAgentCount, activeBackgroundCommandCount, activeWorkflowCount } =
    entry.activity;
  const background =
    activeBackgroundAgentCount + activeBackgroundCommandCount + activeWorkflowCount;
  if (background > 0) {
    flags.push({
      kind: "background",
      label:
        background === 1 ? "1 background task" : `${background} background tasks`,
    });
  }
  if (entry.queuedWork === "failed") {
    flags.push({ kind: "queued-failed", label: "Queued message failed" });
  } else if (entry.queuedWork === "waiting") {
    flags.push({ kind: "queued-waiting", label: "Message waiting" });
  }
  return flags;
}

export function getSubagentBucket(entry: SubagentEntry): SubagentBucket {
  if (entry.hasPendingInteraction) return "needs-input";
  const status = entry.runtime.displayStatus;
  if (status === "error") return "failed";
  if (status === "host-reconnecting" || status === "waiting-for-host") return "host";
  if (status === "pending") return "not-started";
  if (isRunningThreadRuntimeDisplayStatus(status)) return "working";
  return "idle";
}

export function getSubagentTask(entry: SubagentEntry): {
  title: string;
  task: string | null;
} {
  const title = getThreadDisplayTitle(entry);
  const task = entry.titleFallback?.trim() ?? "";
  return { title, task: task && task !== title ? task : null };
}

export function buildSubagentTree(
  rootThreadId: string,
  entries: readonly SubagentEntry[],
  coverage: SubagentCoverage = "all-visible",
): SubagentNode[] {
  const byParent = new Map<string, SubagentEntry[]>();
  for (const entry of entries) {
    if (!entry.parentThreadId || entry.id === rootThreadId) continue;
    const siblings = byParent.get(entry.parentThreadId);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.parentThreadId, [entry]);
  }
  const visited = new Set<string>([rootThreadId]);
  const build = (parentId: string): SubagentNode[] => {
    const children = (byParent.get(parentId) ?? [])
      .filter((entry) => !visited.has(entry.id))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const child of children) visited.add(child.id);
    return children.map((entry) => {
      const nested = build(entry.id);
      return {
        entry,
        children: nested,
        descendantCount:
          coverage === "direct-only"
            ? null
            : nested.reduce((sum, node) => sum + 1 + (node.descendantCount ?? 0), 0),
      };
    });
  };
  return build(rootThreadId);
}

export function summarizeSubagents(
  roots: readonly SubagentNode[],
  coverage: SubagentCoverage = "all-visible",
): SubagentSummary {
  const buckets: Record<SubagentBucket, number> = {
    working: 0,
    "needs-input": 0,
    failed: 0,
    host: 0,
    "not-started": 0,
    idle: 0,
  };
  for (const root of roots) buckets[getSubagentBucket(root.entry)] += 1;
  return {
    directCount: roots.length,
    nestedCount:
      coverage === "direct-only"
        ? null
        : roots.reduce((sum, root) => sum + (root.descendantCount ?? 0), 0),
    buckets,
  };
}

export const SUBAGENT_BUCKET_LABELS: Record<SubagentBucket, string> = {
  working: "active",
  "needs-input": "need input",
  failed: "error",
  host: "host issue",
  "not-started": "pending",
  idle: "idle",
};
