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
  descendantCount: number;
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

export type SubagentTotal =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "known"; directChildCount: number };

export interface SubagentSummary {
  directCount: number;
  nestedCount: number;
  buckets: Record<SubagentBucket, number>;
  unlistedDirect: number | null;
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
  active: { tone: "working", label: "Working", detail: "A turn is running" },
  starting: { tone: "working", label: "Starting", detail: "Starting a turn" },
  provisioning: {
    tone: "working",
    label: "Provisioning",
    detail: "Preparing its workspace",
  },
  stopping: { tone: "working", label: "Stopping", detail: "Stopping a turn" },
  "host-reconnecting": {
    tone: "attention",
    label: "Host reconnecting",
    detail: "Was working when its host link dropped",
  },
  "waiting-for-host": {
    tone: "attention",
    label: "Waiting for host",
    detail: "Was working; its host is offline",
  },
  pending: {
    tone: "neutral",
    label: "Not started",
    detail: "No turn has been sent yet",
  },
  error: { tone: "error", label: "Failed", detail: "Its last turn failed" },
  idle: {
    tone: "neutral",
    label: "Idle",
    detail: "No turn running · outcome not recorded here",
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
        descendantCount: nested.reduce(
          (sum, node) => sum + 1 + node.descendantCount,
          0,
        ),
      };
    });
  };
  return build(rootThreadId);
}

export function summarizeSubagents(
  roots: readonly SubagentNode[],
  total: SubagentTotal,
): SubagentSummary {
  const buckets: Record<SubagentBucket, number> = {
    working: 0,
    "needs-input": 0,
    failed: 0,
    host: 0,
    "not-started": 0,
    idle: 0,
  };
  let nestedCount = 0;
  const visit = (node: SubagentNode, depth: number) => {
    buckets[getSubagentBucket(node.entry)] += 1;
    if (depth > 0) nestedCount += 1;
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return {
    directCount: roots.length,
    nestedCount,
    buckets,
    unlistedDirect:
      total.state === "known"
        ? Math.max(0, total.directChildCount - roots.length)
        : null,
  };
}

export const SUBAGENT_BUCKET_LABELS: Record<SubagentBucket, string> = {
  working: "working",
  "needs-input": "need input",
  failed: "failed",
  host: "host issue",
  "not-started": "not started",
  idle: "idle",
};
