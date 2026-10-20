import {
  getThreadListIndicatorLabel,
  hasThreadListWorkingActivity,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
} from "@cloudroom/client-core";
import type { Host, ThreadListEntry } from "@cloudroom/domain";
import type {
  FleetPendingField,
  FleetSupplementResponse,
  FleetThreadFields,
  SidebarBootstrapResponse,
} from "@cloudroom/server-contract";

export type FleetThreadKind =
  | "thread"
  | "child"
  | "side-chat"
  | "workflow"
  | "plugin"
  | "fork";
export type FleetParentStatus = "none" | "known" | "unknown" | "archived";
export type FleetRuntime =
  | "input"
  | "error"
  | "offline"
  | "reconnecting"
  | "starting"
  | "working"
  | "idle";
export type FleetAttention =
  | "waiting"
  | "failed"
  | "host-offline"
  | "new-reply";
export type FleetSandbox = "awake" | "not-awake" | "unknown";
export type FleetLocationKind = "cloud" | "machine";

export interface FleetThread {
  entry: ThreadListEntry;
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  kind: FleetThreadKind;
  parentId: string | null;
  parentStatus: FleetParentStatus;
  fields: FleetThreadFields | null;
  indicator: ThreadListIndicatorKind;
  indicatorLabel: string | null;
  runtime: FleetRuntime;
  attention: FleetAttention | null;
  unread: boolean;
  archived: boolean;
  location: {
    kind: FleetLocationKind;
    hostId: string | null;
    hostName: string | null;
    online: boolean | null;
  };
  sandbox: FleetSandbox | null;
  inTurnSubagents: number;
}

export interface FleetFamily {
  thread: FleetThread;
  children: FleetFamily[];
}

export interface FleetProjectGroup {
  projectId: string;
  projectName: string;
  families: FleetFamily[];
  total: number;
  attention: number;
  working: number;
  liftedIds: ReadonlySet<string>;
}

export type FleetStateFilter =
  | "attention"
  | "working"
  | "connecting"
  | "idle"
  | "not-awake"
  | "archived";

export interface FleetFilters {
  query: string;
  projectIds: ReadonlySet<string>;
  locations: ReadonlySet<string>;
  harnesses: ReadonlySet<string>;
  state: FleetStateFilter | null;
}

export const EMPTY_FLEET_FILTERS: FleetFilters = {
  query: "",
  projectIds: new Set(),
  locations: new Set(),
  harnesses: new Set(),
  state: null,
};

export interface FleetModel {
  threads: FleetThread[];
  byId: ReadonlyMap<string, FleetThread>;
  matchedIds: ReadonlySet<string>;
  attention: FleetThread[];
  projects: FleetProjectGroup[];
  shown: number;
  total: number;
  counts: {
    attention: number;
    working: number;
    connecting: number;
    idle: number;
    archived: number;
    awake: number;
    notAwake: number;
    sandboxUnknown: number;
    awakeByHarness: Record<string, number>;
    byHarness: Record<string, number>;
    byLocation: Record<string, number>;
    byProject: Record<string, number>;
  };
  source: FleetSupplementResponse["source"] | "unavailable" | "loading";
  projectOptions: { id: string; name: string; hidden: boolean }[];
  pendingFields: ReadonlySet<FleetPendingField>;
  unavailableSources: readonly string[];
}

const ATTENTION_ORDER: Record<FleetAttention, number> = {
  waiting: 0,
  failed: 1,
  "host-offline": 2,
  "new-reply": 3,
};

export const ALL_PENDING_FIELDS: readonly FleetPendingField[] = [
  "configuredExecution",
  "inputRequest",
  "errorSummary",
  "activityLabel",
  "fallbackModel",
  "cloudSandboxState",
  "workflowLineage",
];

function kindOf(entry: ThreadListEntry): FleetThreadKind {
  if (entry.originPluginId === "workflows") return "workflow";
  if (entry.originPluginId === "side-chat") return "side-chat";
  if (entry.visibility === "hidden" && entry.originPluginId !== null)
    return "plugin";
  if (entry.originKind === "fork") return "fork";
  if (entry.parentThreadId !== null) return "child";
  return "thread";
}

function claimedParent(
  entry: ThreadListEntry,
  fields: FleetThreadFields | null,
): string | null {
  if (entry.parentThreadId !== null) return entry.parentThreadId;
  if (entry.originKind !== null && entry.sourceThreadId !== null)
    return entry.sourceThreadId;
  if (entry.originPluginId === "workflows")
    return fields?.workflowParentThreadId ?? null;
  return null;
}

function runtimeOf(entry: ThreadListEntry): FleetRuntime {
  if (entry.hasPendingInteraction) return "input";
  if (entry.status === "error") return "error";
  const display = entry.runtime.displayStatus;
  if (display === "waiting-for-host") return "offline";
  if (display === "host-reconnecting") return "reconnecting";
  if (display === "provisioning" || entry.status === "starting")
    return "starting";
  if (
    hasThreadListWorkingActivity(
      threadListIndicatorStateForThread(entry, false),
    )
  )
    return "working";
  return "idle";
}

export function isUnread(entry: ThreadListEntry): boolean {
  return isUnreadDoneThread(entry);
}

function attentionOf(
  entry: ThreadListEntry,
  runtime: FleetRuntime,
  unread: boolean,
): FleetAttention | null {
  if (entry.archivedAt !== null) return null;
  if (runtime === "input") return "waiting";
  if (runtime === "error") return "failed";
  if (entry.queuedWork === "failed" && runtime === "idle") return "failed";
  if (runtime === "offline") return "host-offline";
  if (unread && runtime === "idle") return "new-reply";
  return null;
}

function locationOf(
  entry: ThreadListEntry,
  hosts: ReadonlyMap<string, Host>,
): FleetThread["location"] {
  if (entry.executionTarget === "cloud")
    return { kind: "cloud", hostId: null, hostName: null, online: null };
  const host = entry.environmentHostId
    ? hosts.get(entry.environmentHostId)
    : undefined;
  return {
    kind: "machine",
    hostId: entry.environmentHostId,
    hostName: host?.name ?? null,
    online: host ? host.status === "connected" : null,
  };
}

function sandboxOf(
  entry: ThreadListEntry,
  fields: FleetThreadFields | null,
): FleetSandbox | null {
  if (entry.executionTarget !== "cloud") return null;
  return fields?.cloudSandbox?.state ?? "unknown";
}

function matchesState(
  thread: FleetThread,
  state: FleetStateFilter | null,
): boolean {
  if (state === null) return !thread.archived;
  if (state === "archived") return thread.archived;
  if (thread.archived) return false;
  switch (state) {
    case "attention":
      return thread.attention !== null;
    case "working":
      return thread.runtime === "working";
    case "connecting":
      return thread.runtime === "starting" || thread.runtime === "reconnecting";
    case "idle":
      return thread.runtime === "idle" && thread.attention === null;
    case "not-awake":
      return thread.sandbox === "not-awake";
  }
}

export function locationKey(thread: FleetThread): string {
  return thread.location.kind === "cloud"
    ? "cloud"
    : `host:${thread.location.hostId ?? "unknown"}`;
}

function matchesFilters(
  thread: FleetThread,
  filters: FleetFilters,
  searchNames: boolean,
): boolean {
  if (!matchesState(thread, filters.state)) return false;
  if (filters.projectIds.size > 0 && !filters.projectIds.has(thread.projectId))
    return false;
  if (
    filters.harnesses.size > 0 &&
    !filters.harnesses.has(thread.entry.providerId)
  )
    return false;
  if (filters.locations.size > 0 && !filters.locations.has(locationKey(thread)))
    return false;
  const query = filters.query.trim().toLowerCase();
  if (query === "") return true;
  const haystack = [
    searchNames ? thread.title : "",
    searchNames ? thread.projectName : "",
    searchNames ? (thread.entry.environmentBranchName ?? "") : "",
    thread.fields?.configuredModel ?? "",
    searchNames ? (thread.location.hostName ?? "") : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function bump(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

export function buildFleetModel(args: {
  bootstrap: SidebarBootstrapResponse;
  supplement: FleetSupplementResponse | undefined;
  hosts: readonly Host[] | undefined;
  filters: FleetFilters;
  searchNames?: boolean;
  supplementLoading?: boolean;
}): FleetModel {
  const { bootstrap, supplement, filters } = args;
  const hosts = new Map((args.hosts ?? []).map((host) => [host.id, host]));
  const projectNames = new Map<string, string>();
  const projectOptions = [
    ...bootstrap.projects.map((project) => ({
      id: project.id,
      name: project.name,
      hidden: false,
    })),
    {
      id: bootstrap.personalProject.id,
      name: bootstrap.personalProject.name,
      hidden: false,
    },
    ...(supplement?.extraProjects ?? []),
  ];
  for (const project of projectOptions)
    projectNames.set(project.id, project.name);
  const entries: ThreadListEntry[] = [
    ...bootstrap.projects.flatMap((project) => project.threads),
    ...bootstrap.personalProject.threads,
    ...(supplement?.hiddenThreads ?? []),
    ...(supplement?.archivedThreads ?? []),
  ];
  const seen = new Set<string>();
  const threads: FleetThread[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const fields = supplement?.threadFields[entry.id] ?? null;
    const runtime = runtimeOf(entry);
    const unread = isUnread(entry);
    const indicator = resolveThreadListIndicator(
      threadListIndicatorStateForThread(entry, false),
    );
    threads.push({
      entry,
      id: entry.id,
      title: entry.title ?? entry.titleFallback ?? "Untitled thread",
      projectId: entry.projectId,
      projectName: projectNames.get(entry.projectId) ?? "Unknown project",
      kind: kindOf(entry),
      parentId: claimedParent(entry, fields),
      parentStatus: "none",
      fields,
      indicator,
      indicatorLabel: getThreadListIndicatorLabel(indicator),
      runtime,
      attention: attentionOf(entry, runtime, unread),
      unread,
      archived: entry.archivedAt !== null,
      location: locationOf(entry, hosts),
      sandbox: sandboxOf(entry, fields),
      inTurnSubagents: entry.activity.activeBackgroundAgentCount,
    });
  }
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const archivedView = filters.state === "archived";
  for (const thread of threads) {
    const parent =
      thread.parentId !== null ? byId.get(thread.parentId) : undefined;
    if (parent && !archivedView && parent.archived && !thread.archived) {
      thread.parentStatus = "archived";
      thread.parentId = null;
    } else if (parent) thread.parentStatus = "known";
    else if (thread.parentId !== null || thread.kind === "workflow") {
      thread.parentStatus = "unknown";
      thread.parentId = null;
    }
  }
  for (const thread of threads) {
    const seenInChain = new Set<string>([thread.id]);
    let cursor = thread.parentId;
    while (cursor !== null) {
      if (seenInChain.has(cursor)) {
        thread.parentStatus = "unknown";
        thread.parentId = null;
        break;
      }
      seenInChain.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const matched = new Set(
    threads
      .filter((thread) =>
        matchesFilters(thread, filters, args.searchNames ?? true),
      )
      .map((thread) => thread.id),
  );
  const visible = new Set(matched);
  for (const id of matched) {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent !== null && !visible.has(parent)) {
      visible.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }

  const latest = (family: FleetFamily): number =>
    Math.max(family.thread.entry.updatedAt, ...family.children.map(latest));
  const childrenOf = new Map<string, FleetThread[]>();
  for (const thread of threads) {
    if (thread.parentId === null || !visible.has(thread.id)) continue;
    const list = childrenOf.get(thread.parentId) ?? [];
    list.push(thread);
    childrenOf.set(thread.parentId, list);
  }
  const buildFamily = (thread: FleetThread): FleetFamily => ({
    thread,
    children: (childrenOf.get(thread.id) ?? [])
      .map(buildFamily)
      .sort((a, b) => latest(b) - latest(a)),
  });

  const attention =
    filters.state === "archived"
      ? []
      : threads
          .filter(
            (thread) => matched.has(thread.id) && thread.attention !== null,
          )
          .sort(
            (a, b) =>
              ATTENTION_ORDER[a.attention ?? "new-reply"] -
                ATTENTION_ORDER[b.attention ?? "new-reply"] ||
              b.entry.latestAttentionAt - a.entry.latestAttentionAt,
          );
  const liftedIds = new Set(attention.map((thread) => thread.id));

  const groups = new Map<string, FleetProjectGroup>();
  for (const thread of threads) {
    if (!visible.has(thread.id) || thread.parentId !== null) continue;
    const group = groups.get(thread.projectId) ?? {
      projectId: thread.projectId,
      projectName: thread.projectName,
      families: [],
      total: 0,
      attention: 0,
      working: 0,
      liftedIds,
    };
    group.families.push(buildFamily(thread));
    groups.set(thread.projectId, group);
  }
  for (const group of groups.values()) {
    const walk = (family: FleetFamily) => {
      if (matched.has(family.thread.id)) {
        group.total += 1;
        if (family.thread.attention !== null) group.attention += 1;
        if (family.thread.runtime === "working") group.working += 1;
      }
      family.children.forEach(walk);
    };
    group.families.forEach(walk);
    group.families.sort(
      (a, b) =>
        Number(b.thread.entry.pinnedAt !== null) -
          Number(a.thread.entry.pinnedAt !== null) || latest(b) - latest(a),
    );
  }
  const projects = [...groups.values()].sort(
    (a, b) =>
      b.attention - a.attention ||
      Math.max(...b.families.map(latest)) - Math.max(...a.families.map(latest)),
  );

  const open = threads.filter((thread) => !thread.archived);
  const counts: FleetModel["counts"] = {
    attention: open.filter((thread) => thread.attention !== null).length,
    working: open.filter((thread) => thread.runtime === "working").length,
    connecting: open.filter(
      (thread) =>
        thread.runtime === "starting" || thread.runtime === "reconnecting",
    ).length,
    idle: open.filter(
      (thread) => thread.runtime === "idle" && thread.attention === null,
    ).length,
    archived: supplement?.archivedCount ?? threads.length - open.length,
    awake: open.filter((thread) => thread.sandbox === "awake").length,
    notAwake: open.filter((thread) => thread.sandbox === "not-awake").length,
    sandboxUnknown: open.filter((thread) => thread.sandbox === "unknown")
      .length,
    awakeByHarness: {},
    byHarness: {},
    byLocation: {},
    byProject: {},
  };
  for (const thread of open) {
    if (thread.sandbox === "awake")
      bump(counts.awakeByHarness, thread.entry.providerId);
    bump(counts.byHarness, thread.entry.providerId);
    bump(counts.byLocation, locationKey(thread));
    bump(counts.byProject, thread.projectId);
  }

  return {
    threads,
    byId,
    matchedIds: matched,
    attention,
    projects,
    shown: matched.size,
    total: filters.state === "archived" ? counts.archived : open.length,
    counts,
    source:
      supplement?.source ??
      (args.supplementLoading ? "loading" : "unavailable"),
    projectOptions,
    pendingFields: new Set(
      supplement
        ? supplement.pendingFields
        : args.supplementLoading
          ? []
          : ALL_PENDING_FIELDS,
    ),
    unavailableSources: supplement?.unavailableSources ?? [
      args.supplementLoading
        ? "Fleet details still loading: side chats, workflow workers and archived threads not listed yet"
        : "Fleet details unavailable: side chats, workflow workers and archived threads not listed",
    ],
  };
}

export interface FleetStateWord {
  glyph: string;
  word: string;
  tone: "warn" | "error" | "offline" | "busy" | "idle" | "new";
}

export function stateWord(thread: FleetThread): FleetStateWord {
  if (thread.archived) return { glyph: "▪", word: "Archived", tone: "idle" };
  switch (thread.runtime) {
    case "input":
      return {
        glyph: "◆",
        word:
          thread.fields?.inputKind === "approval"
            ? "Needs approval"
            : thread.fields?.inputKind === "question"
              ? "Needs answer"
              : "Needs input",
        tone: "warn",
      };
    case "error":
      return { glyph: "▲", word: "Error", tone: "error" };
    case "offline":
      return { glyph: "⊘", word: "Host offline", tone: "offline" };
    case "reconnecting":
      return { glyph: "↻", word: "Reconnecting", tone: "offline" };
    case "starting":
      return { glyph: "⋯", word: "Starting", tone: "busy" };
    case "working":
      return { glyph: "◐", word: "Working", tone: "busy" };
    case "idle":
      if (thread.archived)
        return { glyph: "▪", word: "Archived", tone: "idle" };
      if (thread.entry.queuedWork === "failed")
        return { glyph: "▲", word: "Queue failed", tone: "error" };
      return thread.unread
        ? { glyph: "●", word: "Idle · new reply", tone: "new" }
        : { glyph: "○", word: "Idle", tone: "idle" };
  }
}

export const ATTENTION_LABELS: Record<FleetAttention, string> = {
  waiting: "Waiting on you",
  failed: "Failed",
  "host-offline": "Host offline",
  "new-reply": "New replies",
};

export const KIND_LABELS: Record<FleetThreadKind, string | null> = {
  thread: null,
  child: "child thread",
  "side-chat": "side chat",
  workflow: "workflow worker",
  plugin: "plugin thread",
  fork: "fork",
};

export function sandboxWord(thread: FleetThread, now: number): string | null {
  if (thread.sandbox === null) return null;
  const sandbox = thread.fields?.cloudSandbox ?? null;
  if (thread.sandbox === "unknown" || sandbox === null)
    return "sleep state unknown";
  const word = thread.sandbox === "awake" ? "awake" : "not awake";
  if (sandbox.lastCheckError !== null) return `${word} · last known`;
  if (sandbox.lastSuccessfulCheckAt === null) return `${word} · not checked`;
  return `${word} · checked ${formatAge(now - sandbox.lastSuccessfulCheckAt)}`;
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function familyCounts(family: FleetFamily): {
  total: number;
  attention: number;
  working: number;
} {
  let total = 0;
  let attention = 0;
  let working = 0;
  const walk = (node: FleetFamily) => {
    for (const child of node.children) {
      total += 1;
      if (child.thread.attention !== null) attention += 1;
      if (child.thread.runtime === "working") working += 1;
      walk(child);
    }
  };
  walk(family);
  return { total, attention, working };
}

export interface FleetRedactor {
  on: boolean;
  title(thread: FleetThread): string;
  project(projectId: string, name: string): string;
  host(hostId: string | null, name: string | null): string | null;
  text(value: string | null): string | null;
}

export function createRedactor(
  on: boolean,
  projectOrder: readonly string[],
  hostOrder: readonly string[],
): FleetRedactor {
  return {
    on,
    title: (thread) => (on ? "Hidden title" : thread.title),
    project: (projectId, name) =>
      on ? `Project ${projectOrder.indexOf(projectId) + 1}` : name,
    host: (hostId, name) => {
      if (!on) return name;
      const index = hostId === null ? -1 : hostOrder.indexOf(hostId);
      return index === -1 ? "Machine (name hidden)" : `Machine ${index + 1}`;
    },
    text: (value) => (on ? null : value),
  };
}

export type FleetSort = "attention" | "latest" | "title";

export function sortProjects(
  projects: readonly FleetProjectGroup[],
  sort: FleetSort,
): FleetProjectGroup[] {
  const latest = (family: FleetFamily): number =>
    Math.max(family.thread.entry.updatedAt, ...family.children.map(latest));
  const groupLatest = (group: FleetProjectGroup) =>
    Math.max(0, ...group.families.map(latest));
  const sorted = [...projects];
  if (sort === "title")
    sorted.sort((a, b) => a.projectName.localeCompare(b.projectName));
  else if (sort === "latest")
    sorted.sort((a, b) => groupLatest(b) - groupLatest(a));
  return sorted;
}
