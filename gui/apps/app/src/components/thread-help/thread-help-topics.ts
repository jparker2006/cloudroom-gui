export const THREAD_HELP_DOCS = {
  index: "https://www.cloudroom.dev/docs",
  localOrCloud: "https://www.cloudroom.dev/docs/local-threads#local-or-cloud",
  sleepAndWake: "https://www.cloudroom.dev/docs/cloud-threads#sleep-and-wake",
  queues:
    "https://www.cloudroom.dev/docs/cloud-threads#messages-queues-and-stop",
  whoDoesWhat: "https://www.cloudroom.dev/docs/harnesses#who-does-what",
  startFails: "https://www.cloudroom.dev/docs/harnesses#if-a-start-fails",
  pricing: "https://www.cloudroom.dev/pricing",
} as const;

export type ThreadHelpTopicId =
  | "where-it-runs"
  | "awake-connected-working"
  | "context-usage"
  | "compactions"
  | "limits"
  | "reconnecting"
  | "host-disconnected"
  | "connect-harness"
  | "start-error";

export interface ThreadHelpTopic {
  id: ThreadHelpTopicId;
  title: string;
  keywords: readonly string[];
  summary: string;
  points: readonly string[];
  nextStep: string | null;
  docs: { label: string; href: string };
  related: readonly ThreadHelpTopicId[];
  sources: readonly string[];
}

export const THREAD_HELP_TOPICS: readonly ThreadHelpTopic[] = [
  {
    id: "where-it-runs",
    title: "Local, Local Worktree, and Cloud",
    keywords: [
      "environment",
      "local",
      "worktree",
      "cloud",
      "sandbox",
      "branch",
      "folder",
      "teleport",
      "machine",
    ],
    summary:
      "The label next to the project shows where this thread's agent runs and which files it edits.",
    points: [
      "Local: the agent runs on your computer, in your project folder. It edits the same files your editor sees.",
      "Local Worktree: the agent runs on your computer in a separate copy of the repo with its own Git branch, so parallel threads don't collide.",
      "Cloud: the agent runs in its own cloud sandbox, on its own branch. It keeps working when your computer sleeps or the app is closed.",
      "Git diff, file preview, and worktrees work only on Local threads.",
    ],
    nextStep:
      "To move this thread, look for Teleport to Cloud or Teleport to Local in the thread menu. They show only for parent threads on harnesses that support Teleport.",
    docs: { label: "Local or Cloud", href: THREAD_HELP_DOCS.localOrCloud },
    related: ["awake-connected-working", "host-disconnected"],
    sources: [
      "apps/app/src/lib/cloudroom-environment-label.ts",
      "apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx",
      "apps/app/src/components/thread/ThreadActionsMenu.tsx",
      "docs/worktrees.md",
    ],
  },
  {
    id: "awake-connected-working",
    title: "Awake, connected, and working",
    keywords: [
      "sleep",
      "asleep",
      "awake",
      "wake",
      "idle",
      "active",
      "running",
      "done",
      "busy",
      "stuck",
      "agent",
      "stop",
      "status",
      "connection",
    ],
    summary:
      "These are three separate things. One does not tell you the others.",
    points: [
      "Sandbox awake or asleep (Cloud only): whether the thread's cloud computer is running. It sleeps after an idle period that depends on your plan, and never while a turn runs or messages wait. Your next message wakes it. Files and history survive sleep.",
      "Connected: whether this app can reach where the agent runs. That is the host on your computer for Local threads, or Cloudroom for Cloud threads.",
      "Working: whether a turn is running now. While it runs, the send button turns into Stop when the message box is empty.",
      "Awake does not mean the agent is thinking. Idle does not mean the task is done or correct. Read the last reply.",
      "The thread does not show a live awake or asleep label. Don't infer it from the other two.",
    ],
    nextStep:
      "If the agent seems stuck, clear the message box, check for Stop, and read the last timeline row before you send again.",
    docs: { label: "Sleep and wake", href: THREAD_HELP_DOCS.sleepAndWake },
    related: ["reconnecting", "host-disconnected"],
    sources: [
      "apps/server/src/services/cloudroom/sandboxes.ts",
      "packages/domain/src/thread-status.ts",
      "apps/app/src/components/machines/machine-status.ts",
      "apps/server/src/services/threads/thread-runtime-display.ts",
    ],
  },
  {
    id: "context-usage",
    title: "Context usage",
    keywords: [
      "context",
      "window",
      "tokens",
      "ring",
      "full",
      "estimated",
      "estimate",
      "memory",
      "percent",
    ],
    summary:
      "The ring next to the message box shows how much of the model's context window this conversation fills, as last reported by the harness.",
    points: [
      "Context is this thread's working memory with the model. It is not your provider quota or your Cloudroom plan.",
      "Hover, click, or tap the ring for tokens used and the window size.",
      '"Estimated context" means the harness reported an estimate, not an exact count.',
      "No ring means the harness has not reported usage for this thread yet. It does not mean zero.",
      "The number is the last report, so it can lag behind a running turn.",
    ],
    nextStep:
      "Near the limit, start a new thread for a new task, or let the harness compact.",
    docs: { label: "Who does what", href: THREAD_HELP_DOCS.whoDoesWhat },
    related: ["compactions", "limits"],
    sources: [
      "apps/app/src/components/thread/timeline/ThreadContextWindowIndicator.tsx",
      "apps/app/src/components/thread/timeline/thread-context-window-usage.ts",
      "packages/thread-view/src/thread-context-window-usage.ts",
    ],
  },
  {
    id: "compactions",
    title: "Context compacted",
    keywords: [
      "compact",
      "compacted",
      "compaction",
      "summary",
      "summarized",
      "forgot",
      "forget",
      "context",
    ],
    summary:
      "When context fills up, the harness can replace older turns with a summary. Each attempt shows as a row in the timeline.",
    points: [
      '"Context compacted": the harness summarized earlier turns. The timeline still shows them, but what the model keeps from them is up to the harness.',
      '"Context compaction failed", "skipped", or "interrupted": Cloudroom recorded that this attempt did not complete.',
      "The harness decides when and how to compact, not Cloudroom. When you click the ring and the harness reported an auto-compact point, a dashed line marks it.",
    ],
    nextStep:
      "If the agent loses track of something after a compaction, restate it in your next message.",
    docs: { label: "Who does what", href: THREAD_HELP_DOCS.whoDoesWhat },
    related: ["context-usage"],
    sources: [
      "packages/thread-view/src/operation-projection.ts",
      "packages/thread-view/src/compaction-lifecycle.ts",
      "apps/app/src/components/thread/timeline/ThreadContextWindowIndicator.tsx",
    ],
  },
  {
    id: "limits",
    title: "Provider quota, context, and plan limits",
    keywords: [
      "limit",
      "quota",
      "disk",
      "usage",
      "plan",
      "billing",
      "pricing",
      "rate",
      "5h",
      "weekly",
      "free",
      "pro",
      "upgrade",
      "tokens",
    ],
    summary:
      "Different limits can stop work. Each comes from a different place, and the notice names the one you hit.",
    points: [
      "Provider quota: your model account's usage at Anthropic, OpenAI, or another provider. Cloudroom does not set or bill it. Settings → Agents → Usage shows it when a usage source reports it. Unreported usage shows as unavailable, never as zero. After a failed refresh it keeps the last values with a retry notice, so they may be out of date.",
      "Thread context: how full this one conversation is. It is not quota.",
      "Cloudroom plan: how many cloud agents and how much cloud time your plan includes. At the limit, Cloud threads show a notice. Your messages are saved and Local threads still work.",
      "A full cloud disk shows its own notice. That is not a usage limit.",
    ],
    nextStep:
      "Read which limit the notice names. For plan limits, see Pricing. For provider limits, check your provider account.",
    docs: { label: "Pricing", href: THREAD_HELP_DOCS.pricing },
    related: ["context-usage"],
    sources: [
      "apps/app/src/components/CloudUsageLimitNotice.tsx",
      "plugins/provider-usage/README.md",
      "apps/server/src/services/cloudroom/sandboxes.ts",
    ],
  },
  {
    id: "reconnecting",
    title: "Reconnecting or offline",
    keywords: [
      "reconnect",
      "reconnecting",
      "offline",
      "network",
      "retry",
      "connection",
      "lost",
      "internet",
    ],
    summary:
      "This app lost contact with the Cloud thread. It keeps retrying on its own.",
    points: [
      '"Offline" means this device has no network, or the app\'s own server did not answer.',
      "Work the cloud already accepted keeps running. Its replies are saved and appear when the app reconnects.",
      "Messages you send while offline wait on this device until they are delivered.",
    ],
    nextStep:
      "Use Retry to check now. If it never clears, check your network, then restart the app.",
    docs: {
      label: "Messages, queues, and Stop",
      href: THREAD_HELP_DOCS.queues,
    },
    related: ["awake-connected-working", "start-error"],
    sources: [
      "apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx",
      "apps/server/src/services/cloudroom/commands.ts",
    ],
  },
  {
    id: "host-disconnected",
    title: "Host disconnected",
    keywords: [
      "host",
      "disconnected",
      "machine",
      "mac",
      "computer",
      "offline",
      "daemon",
      "waiting",
      "sleep",
    ],
    summary:
      "A Local thread runs through a host on the computer that runs the agent. The app can't reach that host right now.",
    points: [
      '"… disconnected. Waiting for reconnection...": the connection dropped recently, and Cloudroom waits a short grace period.',
      '"… disconnected" alone: the grace period passed. The thread can\'t continue until the host is back.',
      "Local threads stop when that computer sleeps.",
    ],
    nextStep:
      "Wake that computer and open Cloudroom on it. Settings → Machines shows each machine's status.",
    docs: { label: "Local or Cloud", href: THREAD_HELP_DOCS.localOrCloud },
    related: ["where-it-runs", "awake-connected-working"],
    sources: [
      "apps/server/src/services/threads/thread-runtime-display.ts",
      "apps/app/src/views/thread-detail/ThreadDetailView.tsx",
      "apps/app/src/components/machines/machine-status.ts",
    ],
  },
  {
    id: "connect-harness",
    title: "Connect a harness to start",
    keywords: [
      "connect",
      "sign in",
      "login",
      "log in",
      "auth",
      "account",
      "claude",
      "codex",
      "harness",
      "provider",
    ],
    summary:
      "The harness, such as Claude Code or Codex, runs with your own account. It needs a login before it can start. Your first message is saved.",
    points: [
      "Cloud threads use logins you connect once. Cloudroom writes them into each sandbox when it wakes.",
      "Local threads use the harness's login on your computer.",
    ],
    nextStep:
      "Use Connect, or Sign in to Claude, on the notice. You can also use Settings → Agents → Providers. Then use Retry start if it shows.",
    docs: { label: "If a start fails", href: THREAD_HELP_DOCS.startFails },
    related: ["start-error"],
    sources: [
      "apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx",
      "apps/server/src/services/cloudroom/commands.ts",
    ],
  },
  {
    id: "start-error",
    title: "Start failed or thread error",
    keywords: [
      "error",
      "failed",
      "fail",
      "start",
      "session",
      "retry",
      "broken",
      "crash",
    ],
    summary:
      "The thread could not start, or its session hit an error. The notice shows the message from Cloudroom or the harness.",
    points: [
      "Retry start sends your saved first message again. Reconnect checks the thread's status again.",
      "Errors can come from a login, the model, the sandbox, or the network. The message names the cause. This help can't see it.",
    ],
    nextStep:
      "Fix what the message names, then use Retry start or send a follow-up.",
    docs: { label: "If a start fails", href: THREAD_HELP_DOCS.startFails },
    related: ["connect-harness", "reconnecting"],
    sources: [
      "apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx",
      "apps/app/src/components/promptbox/follow-up-placeholder.ts",
    ],
  },
];

const TOPICS_BY_ID = new Map(
  THREAD_HELP_TOPICS.map((topic) => [topic.id, topic]),
);

export function threadHelpTopic(id: string): ThreadHelpTopic | null {
  return TOPICS_BY_ID.get(id as ThreadHelpTopicId) ?? null;
}

export const THREAD_HELP_HASH = "#thread-help";
export const THREAD_HELP_HASH_PREFIX = `${THREAD_HELP_HASH}/`;

export function threadHelpHref(id: ThreadHelpTopicId): string {
  return `${THREAD_HELP_HASH_PREFIX}${id}`;
}

export function threadHelpTopicFromHash(hash: string): ThreadHelpTopic | null {
  return hash.startsWith(THREAD_HELP_HASH_PREFIX)
    ? threadHelpTopic(hash.slice(THREAD_HELP_HASH_PREFIX.length))
    : null;
}

export function threadHelpLinkFromHash(
  hash: string,
): { topicId: ThreadHelpTopicId | null } | null {
  if (hash === THREAD_HELP_HASH) return { topicId: null };
  const topic = threadHelpTopicFromHash(hash);
  return topic ? { topicId: topic.id } : null;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "how",
  "i",
  "in",
  "is",
  "it",
  "mean",
  "means",
  "my",
  "see",
  "show",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "what",
  "when",
  "why",
  "with",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function termScore(term: string, topic: ThreadHelpTopic): number {
  const matches = (list: string[]) =>
    list.some((word) => word.startsWith(term));
  if (matches(words(topic.title))) return 3;
  if (matches(topic.keywords.flatMap(words))) return 2;
  if (
    matches(
      words([topic.summary, ...topic.points, topic.nextStep ?? ""].join(" ")),
    )
  )
    return 1;
  return 0;
}

export function searchThreadHelp(query: string): ThreadHelpTopic[] {
  if (query.trim() === "") return [...THREAD_HELP_TOPICS];
  const terms = words(query).filter((term) => !STOP_WORDS.has(term));
  if (terms.length === 0) return [];
  return THREAD_HELP_TOPICS.map((topic, index) => {
    const scores = terms.map((term) => termScore(term, topic));
    return {
      topic,
      index,
      score: scores.every((score) => score > 0)
        ? scores.reduce((a, b) => a + b, 0)
        : 0,
    };
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.topic);
}

export interface ThreadHelpState {
  isCloud: boolean;
  hasContextUsage: boolean;
  reconnecting: boolean;
  hostDisconnected: boolean;
  authRequired: boolean;
  startFailed: boolean;
  usageLimit: boolean;
}

export function relevantThreadHelpTopicIds(
  state: ThreadHelpState,
): ThreadHelpTopicId[] {
  const ids: ThreadHelpTopicId[] = [];
  if (state.authRequired) ids.push("connect-harness");
  if (state.startFailed) ids.push("start-error");
  if (state.usageLimit) ids.push("limits");
  if (state.reconnecting) ids.push("reconnecting");
  if (state.hostDisconnected) ids.push("host-disconnected");
  ids.push("where-it-runs");
  if (state.isCloud) ids.push("awake-connected-working");
  if (state.hasContextUsage) ids.push("context-usage");
  return ids;
}
