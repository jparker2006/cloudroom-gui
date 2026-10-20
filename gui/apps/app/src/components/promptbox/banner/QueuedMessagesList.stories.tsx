import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { threadsQueryKey } from "@/hooks/queries/query-keys";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import {
  makeThreadListEntry,
  makeThreadQueuedMessage,
} from "@cloudroom/test-helpers/domain-fixtures";
import {
  applyQueuedMessageReorder,
  type QueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";
import {
  QueuedMessagesList,
  type QueuedMessagePendingSend,
  type QueuedMessagesSummaryVariant,
} from "@/components/promptbox/banner/QueuedMessagesList";
import { isOptimisticQueuedMessageId } from "@cloudroom/client-core";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Queued Messages",
};

const noop = () => {};

type StageSize = "desktop" | "mobile";

interface PromptStageProps {
  children: ReactNode;
  size: StageSize;
}

function PromptStage({ children, size }: PromptStageProps) {
  return (
    <div
      data-promptbox-shell=""
      className={
        size === "desktop"
          ? "min-w-0 flex-1 pt-4 pb-5"
          : "w-[20rem] shrink-0 pt-4 pb-5"
      }
    >
      {children}
      <div
        aria-hidden
        className="relative z-20 flex h-20 items-start rounded-2xl border border-border bg-background px-4 py-3 text-sm text-subtle-foreground shadow-sm"
      >
        Composer (stand-in)
      </div>
    </div>
  );
}

function ResponsivePromptStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <PromptStage size="desktop">{children}</PromptStage>
      <PromptStage size="mobile">{children}</PromptStage>
    </div>
  );
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const STORY_NOW = Date.now();

type QueuedMessageFixture = Partial<ThreadQueuedMessage> & {
  id: string;
  text?: string;
  attachments?: number;
};

function makeQueuedMessage({
  id,
  text = "Queued follow-up.",
  attachments = 0,
  ...overrides
}: QueuedMessageFixture): ThreadQueuedMessage {
  const attachmentChunks = Array.from({ length: attachments }, (_, index) => ({
    type: "localImage" as const,
    path: `https://placecats.com/${300 + index * 20}/${200 + index * 10}`,
    name: `screenshot-${index + 1}.png`,
    mimeType: "image/png",
    sizeBytes: 100_000 + index * 10_000,
  }));
  return makeThreadQueuedMessage({
    id,
    threadId: "thr_queue",
    content: [{ type: "text", text, mentions: [] }, ...attachmentChunks],
    createdAt: STORY_NOW - 4 * MINUTE_MS,
    updatedAt: STORY_NOW - 4 * MINUTE_MS,
    ...overrides,
  });
}

const threadBusy = { kind: "thread-busy" } as const;

const oneMessage: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_1",
    text: "Also check the timeline error overlay before sending.",
    waitingOn: threadBusy,
  }),
];

const multipleMessages: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_a",
    text: "Also check the timeline error overlay before sending.",
    waitingOn: threadBusy,
  }),
  makeQueuedMessage({
    id: "q_b",
    text: "Confirm the env summary renders without the branch button on unmanaged environments.",
    waitingOn: threadBusy,
  }),
  makeQueuedMessage({
    id: "q_c",
    text: "And run the tests for @cloudroom/thread-view.",
    waitingOn: threadBusy,
  }),
];

const manyMessages: readonly ThreadQueuedMessage[] = Array.from(
  { length: 9 },
  (_, index) =>
    makeQueuedMessage({
      id: `q_many_${index + 1}`,
      text: `Queued follow-up ${index + 1}: check the compact one-line row, ellipsis truncation, and vertical scroll fade in the queue drawer.`,
      waitingOn: threadBusy,
    }),
);

const withAttachments: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_att_1",
    text: "Repro of the layout regression.",
    attachments: 1,
  }),
  makeQueuedMessage({
    id: "q_att_3",
    text: "Three screenshots from the design review.",
    attachments: 3,
  }),
];

const longMessage: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_long",
    text: "Walk through the entire follow-up composer file by file: PromptBoxInternal, FollowUpPromptBox, NewThreadPromptBox, ContextBanner, QueuedMessagesList, PromptStackCard. For each, audit prop names, identify dead fields, and propose a trim. Skip files we already cleaned up earlier this session.",
  }),
];

const quoteSingle: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_single",
    text: "> The migration runs in three phases.\nWhich phase is safe to deploy on a Friday?",
  }),
];

const quoteMultiline: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_multiline",
    text: "> First we backfill the new column with a default value.\n> Then flip reads once every row is populated.\nMakes sense — what about in-flight writes?",
  }),
];

const quoteTwoBlocks: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_two",
    text: "> Backfill the new column first.\nmakes sense\n\n> Then drop the legacy column.\nin the same deploy?",
  }),
];

const quoteOnly: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_only",
    text: "> Just the quoted selection, no reply typed yet.",
  }),
];

const quoteTruncated: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_truncated",
    text: "> phase one — add the column\n> phase two — start dual-writing\n> phase three — backfill old rows\n> phase four — flip reads\n> phase five — stop writing the old column\n> phase six — drop the old column\nwhich of these is reversible?",
  }),
];

const quoteWithAttachment: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_quote_att",
    text: "> The error fires on the second render.\nrepro attached",
    attachments: 1,
  }),
];

const mixedMessages: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "mix_plain_1",
    text: "Also check the timeline error overlay before sending.",
  }),
  makeQueuedMessage({
    id: "mix_quote_1",
    text: "> First we backfill the new column.\n> Then flip reads once every row is populated.\nWhich phase is safe to deploy on a Friday?",
  }),
  makeQueuedMessage({
    id: "mix_plain_2",
    text: "And run the tests for @cloudroom/thread-view.",
  }),
  makeQueuedMessage({
    id: "mix_quote_2",
    text: "> Only after that do we drop the legacy column.\nin the same deploy?",
  }),
];

const waitingForWorkspace: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_provisioning",
    text: "Re-run the setup checks after the workspace is ready.",
    waitingOn: { kind: "provisioning" },
  }),
];

const sendingAfterStop: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_stopping",
    text: "Summarise what you changed before you stopped.",
    waitingOn: { kind: "stopping" },
  }),
];

const waitingForReply: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_interaction",
    text: "Use the selected release region in the deployment plan.",
    waitingOn: { kind: "interaction" },
  }),
];

const waitingForHost: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_host_offline",
    text: "Capture the Safari trace on M4.",
    waitingOn: { kind: "host-offline", hostName: "M4" },
  }),
];

const scheduled: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_scheduled",
    text: "Run the release checks and post the summary.",
    waitingOn: { kind: "time" },
    sendAt: STORY_NOW + 3 * HOUR_MS + 12 * MINUTE_MS,
  }),
];

const scheduledSoon: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_scheduled_soon",
    text: "Kick off the nightly benchmark sweep.",
    waitingOn: { kind: "time" },
    sendAt: STORY_NOW + 45 * 1000,
  }),
];

const pluginWait: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_plugin_held",
    text: "Run the browser matrix against the candidate build.",
    waitingOn: {
      kind: "plugin",
      pluginId: "concurrency-limit",
      reason: "4 of 4 running",
    },
  }),
];

const pluginWaitStale: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_plugin_stale",
    text: "Build the simulator bundle and capture the drawer trace.",
    waitingOn: {
      kind: "plugin",
      pluginId: "mobile-lab",
      reason: "no update for 12m",
    },
  }),
];

const retry: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_retry",
    content: [
      {
        type: "text",
        text: "Deploy the release candidate to staging.",
        mentions: [],
        visibility: "agent-only",
      },
    ],
    payload: {
      kind: "retry",
      retryOfTurnRequestId: "creq_2m4kq7bxvn",
      attempt: 2,
      reason: "Rate limited",
    },
    waitingOn: {
      kind: "plugin",
      pluginId: "provider-retry",
      reason: "Rate limited",
    },
    sendAt: STORY_NOW + 18 * MINUTE_MS,
    editable: false,
    createdAt: STORY_NOW - 22 * MINUTE_MS,
  }),
];

const inFlightMessage = makeQueuedMessage({
  id: "q_in_flight",
  text: "Also audit the empty queue handoff before wrapping up.",
  waitingOn: threadBusy,
});
const inFlight: readonly ThreadQueuedMessage[] = [inFlightMessage];

const failed: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "q_failed",
    text: "Post a concise summary when the checks finish.",
    waitingOn: threadBusy,
    failureReason: "Thread stopped before the message could dispatch",
  }),
];

interface StaticQueuedMessagesListProps {
  queuedMessages: readonly ThreadQueuedMessage[];
  sendDisabled?: boolean;
  actionDisabled?: boolean;
  processingMessageId?: string;
  processingAction?: "send" | "edit" | "delete";
  pendingSend?: QueuedMessagePendingSend | null;
  summaryVariant?: QueuedMessagesSummaryVariant;
}

function StaticQueuedMessagesList({
  queuedMessages,
  sendDisabled = false,
  actionDisabled = false,
  processingMessageId,
  processingAction,
  pendingSend,
  summaryVariant,
}: StaticQueuedMessagesListProps) {
  return (
    <QueuedMessagesList
      attachedToComposer={true}
      queuedMessages={queuedMessages}
      sendAction="send-now"
      sendDisabled={sendDisabled}
      actionDisabled={actionDisabled}
      processingMessageId={processingMessageId ?? null}
      processingAction={processingAction ?? null}
      pendingSend={pendingSend ?? null}
      summaryVariant={summaryVariant}
      onSend={noop}
      onReorder={noop}
      onEdit={noop}
      onDelete={noop}
    />
  );
}

function ReorderableQueuedMessagesList() {
  const [queuedMessages, setQueuedMessages] =
    useState<readonly ThreadQueuedMessage[]>(multipleMessages);
  const handleReorder = useCallback((request: QueuedMessageReorderRequest) => {
    setQueuedMessages((currentQueuedMessages) =>
      applyQueuedMessageReorder({
        queuedMessages: currentQueuedMessages,
        request,
      }),
    );
  }, []);

  return (
    <QueuedMessagesList
      attachedToComposer={true}
      queuedMessages={queuedMessages}
      sendAction="send-now"
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSend={noop}
      onReorder={handleReorder}
      onEdit={noop}
      onDelete={noop}
    />
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="single message" hint="one queued message">
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={oneMessage} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="multiple messages"
        hint="a few messages fit the drawer; the caret collapses it. Drag a row's grip to reorder"
      >
        <ResponsivePromptStage>
          <ReorderableQueuedMessagesList />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="overflowing queue"
        hint="the caret expands an overflowing drawer into the pull-up workspace"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={manyMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="with attachments"
        hint="first image shows as a thumbnail before the text, with a +N badge for more attachments"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={withAttachments} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="long message"
        hint="single line truncates with an ellipsis; title attribute carries full text"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={longMessage} />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Blockquotes() {
  return (
    <StoryCard>
      <StoryRow
        label="mixed: quoted + plain"
        hint="rows stay one line in both drawer and workspace modes"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={mixedMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="plain messages (no quotes)"
        hint="single-line preview, leading icon centered — for comparison"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={multipleMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="quote + reply"
        hint="a single `> ` block above the typed reply"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteSingle} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="multi-line quote"
        hint="every quoted line is prefixed and styled as one blockquote"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteMultiline} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="two quote→reply blocks"
        hint="stacked quote/reply sections in one queued message"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteTwoBlocks} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow label="quote only" hint="quoted selection with no reply yet">
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteOnly} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="long quote (truncated)"
        hint="single-line preview truncates with an ellipsis"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteTruncated} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="quote + attachment"
        hint="the image thumbnail stays visible beside the quoted preview"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={quoteWithAttachment} />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function SteerWaitStates() {
  return (
    <StoryCard>
      <StoryRow
        label="behind a running turn"
        hint="`thread-busy` is the only wait that renders no line — the one-line row stays intact until a wait needs explaining"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={multipleMessages} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="workspace provisioning"
        hint="the workspace is being recreated; Send now is withheld because it cannot clear this wait"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={waitingForWorkspace} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="sending after a stop"
        hint="the user pressed Send now while the thread was stopping; the row explains itself and drops Send now because pressing it again would change nothing"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={sendingAfterStop} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="pending interaction"
        hint="the active turn needs the user's answer; no Send now"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={waitingForReply} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="host offline"
        hint="the active turn cannot reach its enrolled host; no Send now"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={waitingForHost} />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ScheduledAndWaitingDispatch() {
  return (
    <StoryCard>
      <StoryRow
        label="scheduled · hours out"
        hint="coarse countdown beside the scheduled instant; Send now stays available because skipping the schedule genuinely clears the wait"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={scheduled} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="scheduled · due shortly"
        hint="the countdown ticks per second under a minute"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={scheduledSoon} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="plugin wait"
        hint="a plugin names why the dispatch is waiting"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={pluginWait} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="plugin wait · stale"
        hint="the plugin has stopped reporting progress"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={pluginWaitStale} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="retry"
        hint="a failed turn queued by reference; no message to quote, not editable"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={retry} />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function InFlightStates() {
  return (
    <StoryCard>
      <StoryRow
        label="at rest"
        hint="actions stay hidden until hover or focus — hover is CSS-only and cannot be pinned from props"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={scheduled} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="sending"
        hint="the row's own dispatch is in flight; actions withdraw"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={inFlight}
            processingMessageId={inFlightMessage.id}
            processingAction="send"
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="deleting"
        hint="the same line, labelled for the action in flight"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={inFlight}
            processingMessageId={inFlightMessage.id}
            processingAction="delete"
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="processing one of many"
        hint="only the middle row's actions disable; its neighbors stay interactive"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={multipleMessages}
            processingMessageId="q_b"
            processingAction="send"
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="failed"
        hint="the failure replaces the wait line and turns it destructive"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList queuedMessages={failed} />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="send disabled"
        hint='runtime busy — cannot "Send now" but edit/delete still work'
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={multipleMessages}
            sendDisabled
          />
        </ResponsivePromptStage>
      </StoryRow>
      <StoryRow
        label="all actions disabled"
        hint="a queue-wide mutation is in flight"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={multipleMessages}
            actionDisabled
          />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function NarrowSurface() {
  return (
    <StoryCard>
      <StoryRow
        label="queue"
        hint="inline actions collapse into the overflow menu below md; the compact row typography is what the drawer always uses"
      >
        <PromptStage size="mobile">
          <StaticQueuedMessagesList queuedMessages={multipleMessages} />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="queued"
        hint="the wait line truncates rather than wrapping"
      >
        <PromptStage size="mobile">
          <StaticQueuedMessagesList queuedMessages={pluginWaitStale} />
        </PromptStage>
      </StoryRow>
      <StoryRow
        label="retry"
        hint="no Edit entry in the overflow menu for a retry"
      >
        <PromptStage size="mobile">
          <StaticQueuedMessagesList queuedMessages={retry} />
        </PromptStage>
      </StoryRow>
      <StoryRow label="failed" hint="the failure reason truncates on one line">
        <PromptStage size="mobile">
          <StaticQueuedMessagesList queuedMessages={failed} />
        </PromptStage>
      </StoryRow>
    </StoryCard>
  );
}

export function SenderMetadata() {
  const [queryClient] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_review", title: "Code review" }),
    ]);
    return client;
  });
  const messages = [
    makeQueuedMessage({
      id: "q_user",
      text: "Please review the final changes.",
    }),
    makeQueuedMessage({
      id: "q_agent",
      text: "The review is complete. All checks passed.",
      initiator: "agent",
      senderThreadId: "thr_review",
    }),
    makeQueuedMessage({
      id: "q_system",
      text: "The background task has completed.",
      initiator: "system",
      waitingOn: { kind: "provisioning" },
    }),
  ];
  return (
    <QueryClientProvider client={queryClient}>
      <StoryCard>
        <StoryRow
          label="sender metadata"
          hint="Non-user senders share the second line with wait metadata."
        >
          <ResponsivePromptStage>
            <StaticQueuedMessagesList queuedMessages={messages} />
          </ResponsivePromptStage>
        </StoryRow>
      </StoryCard>
    </QueryClientProvider>
  );
}

const SUMMARY_VARIANTS: readonly QueuedMessagesSummaryVariant[] = [
  "strip",
  "stack",
];

const SUMMARY_PENDING_AUTO: QueuedMessagePendingSend = {
  queuedMessageId: "q_a",
  mode: "auto",
};

const SUMMARY_PENDING_STEER: QueuedMessagePendingSend = {
  queuedMessageId: "q_a",
  mode: "steer",
};

const oneBehind: readonly ThreadQueuedMessage[] = [
  makeQueuedMessage({
    id: "sum_behind",
    text: "Then post the summary in the thread.",
    waitingOn: threadBusy,
  }),
];

interface SummaryScenario {
  label: string;
  hint: string;
  queuedMessages: readonly ThreadQueuedMessage[];
  pendingSend?: QueuedMessagePendingSend;
}

const summaryScenarios: readonly SummaryScenario[] = [
  {
    label: "3 waiting",
    hint: "the first row previews; the count covers the rest",
    queuedMessages: multipleMessages,
  },
  {
    label: "9 waiting",
    hint: "a long queue still shows one head row and the total",
    queuedMessages: manyMessages,
  },
  {
    label: "long text head",
    hint: "the head preview truncates on one line",
    queuedMessages: [...longMessage, ...oneBehind],
  },
  {
    label: "image head",
    hint: "the thumbnail stands in for the icon, with a +N badge",
    queuedMessages: [
      makeQueuedMessage({
        id: "sum_img",
        text: "Three screenshots from the design review.",
        attachments: 3,
      }),
      ...oneBehind,
    ],
  },
  {
    label: "file-only head",
    hint: "no image: the file name previews and the attachment count shows",
    queuedMessages: [
      makeQueuedMessage({
        id: "sum_file",
        content: [
          {
            type: "localFile",
            path: "/workspace/logs/trace-2026-10-19.zip",
            name: "trace-2026-10-19.zip",
            mimeType: "application/zip",
            sizeBytes: 2_400_000,
          },
        ],
      }),
      ...oneBehind,
    ],
  },
  {
    label: "blocked · scheduled",
    hint: "the head shows its wait and countdown",
    queuedMessages: [...scheduled, ...oneBehind],
  },
  {
    label: "blocked · host offline",
    hint: "the head names the host that cannot be reached",
    queuedMessages: [...waitingForHost, ...oneBehind],
  },
  {
    label: "blocked · pending reply",
    hint: "the head waits on the user's answer",
    queuedMessages: [...waitingForReply, ...oneBehind],
  },
  {
    label: "blocked · plugin hold",
    hint: "the head names the plugin that holds it",
    queuedMessages: [...pluginWait, ...oneBehind],
  },
  {
    label: "failed head",
    hint: "the failure replaces the head status and the pill counts it",
    queuedMessages: [...failed, ...oneBehind],
  },
  {
    label: "failed mid-queue",
    hint: "the head stays calm; the pill still counts the failed row",
    queuedMessages: [...multipleMessages.slice(0, 1), ...failed, ...oneBehind],
  },
  {
    label: "unconfirmed tail",
    hint: "the optimistic row says it is waiting for the server",
    queuedMessages: [
      ...multipleMessages,
      makeQueuedMessage({
        id: "optimistic-queued-demo",
        text: "Typed just now, waiting for the server to confirm.",
      }),
    ],
  },
  {
    label: "pending auto · 2 left",
    hint: "the send request is in flight; the removed row is not in the list",
    queuedMessages: multipleMessages.slice(1),
    pendingSend: SUMMARY_PENDING_AUTO,
  },
  {
    label: "pending steer · 2 left",
    hint: "the steer request is in flight with the rest of the queue",
    queuedMessages: multipleMessages.slice(1),
    pendingSend: SUMMARY_PENDING_STEER,
  },
  {
    label: "pending · empty queue",
    hint: "no caret or rows: the card only shows the send status",
    queuedMessages: [],
    pendingSend: SUMMARY_PENDING_AUTO,
  },
];

const SUMMARY_CARET_SELECTOR =
  'button[aria-label="Collapse queued messages"], button[aria-label="Expand queued messages"]';

function CollapsedOnMount({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    let frame = 0;
    const pressCaret = (presses: number) => {
      if (
        !wrapper ||
        presses === 0 ||
        wrapper.querySelector("[data-queued-messages-summary]")
      ) {
        return;
      }
      wrapper.querySelector<HTMLButtonElement>(SUMMARY_CARET_SELECTOR)?.click();
      frame = window.requestAnimationFrame(() => pressCaret(presses - 1));
    };
    pressCaret(2);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <div ref={wrapperRef}>{children}</div>;
}

function SummaryScenarioRow({
  summaryVariant,
  scenario,
  collapsed,
}: {
  summaryVariant: QueuedMessagesSummaryVariant;
  scenario: SummaryScenario;
  collapsed: boolean;
}) {
  const list = (
    <StaticQueuedMessagesList
      queuedMessages={scenario.queuedMessages}
      pendingSend={scenario.pendingSend ?? null}
      summaryVariant={summaryVariant}
    />
  );
  return (
    <StoryRow
      label={`${summaryVariant} · ${collapsed ? "collapsed" : "expanded"}`}
      hint={`${scenario.label}: ${scenario.hint}`}
    >
      <ResponsivePromptStage>
        {collapsed ? <CollapsedOnMount>{list}</CollapsedOnMount> : list}
      </ResponsivePromptStage>
    </StoryRow>
  );
}

export function SummaryOptions() {
  return (
    <>
      {SUMMARY_VARIANTS.map((summaryVariant) => (
        <StoryCard key={summaryVariant}>
          {summaryScenarios.map((scenario) => (
            <Fragment key={scenario.label}>
              <SummaryScenarioRow
                summaryVariant={summaryVariant}
                scenario={scenario}
                collapsed={true}
              />
              {scenario.queuedMessages.length === 0 ? null : (
                <SummaryScenarioRow
                  summaryVariant={summaryVariant}
                  scenario={scenario}
                  collapsed={false}
                />
              )}
            </Fragment>
          ))}
        </StoryCard>
      ))}
    </>
  );
}

interface SummaryTransitionState {
  queuedMessages: readonly ThreadQueuedMessage[];
  pendingSend: QueuedMessagePendingSend | null;
  sentMessage: ThreadQueuedMessage | null;
  nextId: number;
}

const initialSummaryTransitionState: SummaryTransitionState = {
  queuedMessages: multipleMessages,
  pendingSend: null,
  sentMessage: null,
  nextId: 1,
};

const transitionButtonClass =
  "rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-state-hover disabled:pointer-events-none disabled:opacity-40";

export function SummaryTransitions() {
  const [summaryVariant, setSummaryVariant] =
    useState<QueuedMessagesSummaryVariant>("strip");
  const [state, setState] = useState(initialSummaryTransitionState);
  const hasPendingSend = state.pendingSend !== null;
  const hasOptimistic = state.queuedMessages.some((queuedMessage) =>
    isOptimisticQueuedMessageId(queuedMessage.id),
  );

  const sendFirst = () =>
    setState((current) => {
      const [head, ...rest] = current.queuedMessages;
      if (head === undefined || current.pendingSend !== null) return current;
      return {
        ...current,
        queuedMessages: rest,
        pendingSend: { queuedMessageId: head.id, mode: "auto" },
        sentMessage: head,
      };
    });
  const serverDelivered = () =>
    setState((current) => ({
      ...current,
      pendingSend: null,
      sentMessage: null,
    }));
  const restoreSent = (
    restore: (sentMessage: ThreadQueuedMessage) => ThreadQueuedMessage,
  ) =>
    setState((current) =>
      current.sentMessage === null
        ? current
        : {
            ...current,
            queuedMessages: [
              restore(current.sentMessage),
              ...current.queuedMessages,
            ],
            pendingSend: null,
            sentMessage: null,
          },
    );
  const serverRequeued = () =>
    restoreSent((sentMessage) => ({
      ...sentMessage,
      waitingOn: threadBusy,
    }));
  const serverError = () => restoreSent((sentMessage) => sentMessage);
  const addMessage = () =>
    setState((current) => ({
      ...current,
      queuedMessages: [
        ...current.queuedMessages,
        makeQueuedMessage({
          id: `optimistic-queued-${current.nextId}`,
          text: "Follow-up typed while the thread runs.",
        }),
      ],
      nextId: current.nextId + 1,
    }));
  const serverConfirmCreate = () =>
    setState((current) => ({
      ...current,
      queuedMessages: current.queuedMessages.map((queuedMessage) =>
        isOptimisticQueuedMessageId(queuedMessage.id)
          ? {
              ...queuedMessage,
              id: queuedMessage.id.replace("optimistic-queued-", "q_"),
            }
          : queuedMessage,
      ),
    }));

  return (
    <StoryCard>
      <StoryRow label="variant" hint="the summary option under test">
        <div className="flex gap-2">
          {SUMMARY_VARIANTS.map((variant) => (
            <button
              key={variant}
              type="button"
              aria-pressed={summaryVariant === variant}
              className={cn(
                transitionButtonClass,
                summaryVariant === variant && "bg-muted",
              )}
              onClick={() => setSummaryVariant(variant)}
            >
              {variant}
            </button>
          ))}
        </div>
      </StoryRow>
      <StoryRow label="client" hint="local actions that change the queue">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={transitionButtonClass}
            disabled={state.queuedMessages.length === 0 || hasPendingSend}
            onClick={sendFirst}
          >
            Send first
          </button>
          <button
            type="button"
            className={transitionButtonClass}
            disabled={hasOptimistic}
            onClick={addMessage}
          >
            Add message
          </button>
        </div>
      </StoryRow>
      <StoryRow
        label="server"
        hint="the outcome of the pending send or create; each one clears it"
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={transitionButtonClass}
            disabled={!hasPendingSend}
            onClick={serverDelivered}
          >
            Server: delivered
          </button>
          <button
            type="button"
            className={transitionButtonClass}
            disabled={!hasPendingSend}
            onClick={serverRequeued}
          >
            Server: re-queued
          </button>
          <button
            type="button"
            className={transitionButtonClass}
            disabled={!hasPendingSend}
            onClick={serverError}
          >
            Server: error
          </button>
          <button
            type="button"
            className={transitionButtonClass}
            disabled={!hasOptimistic}
            onClick={serverConfirmCreate}
          >
            Server: confirm create
          </button>
          <button
            type="button"
            className={transitionButtonClass}
            onClick={() => setState(initialSummaryTransitionState)}
          >
            Reset
          </button>
        </div>
      </StoryRow>
      <StoryRow
        label="queue"
        hint="the list the summary reads from; first in queue order is the head"
      >
        <ResponsivePromptStage>
          <StaticQueuedMessagesList
            queuedMessages={state.queuedMessages}
            pendingSend={state.pendingSend}
            summaryVariant={summaryVariant}
          />
        </ResponsivePromptStage>
      </StoryRow>
    </StoryCard>
  );
}
