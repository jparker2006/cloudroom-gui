import { useState, type ReactNode } from "react";
import type { TimelineRow } from "@cloudroom/server-contract";
import type { ThreadRuntimeDisplayStatus } from "@cloudroom/domain";
import { Button } from "@cloudroom/shared-ui/button";
import {
  CloudIllustrationVariantContext,
  EmptyStateScene,
  type CloudIllustrationVariant,
} from "@cloudroom/shared-ui/empty-state";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { ThreadTimelineSurface } from "@/components/thread/timeline/ThreadTimelineSurface";

export default {
  title: "design/Cloud empty states",
};

const DIRECTIONS: readonly {
  id: CloudIllustrationVariant;
  label: string;
  note: string;
}[] = [
  {
    id: "cumulus",
    label: "A · Cumulus",
    note: "Soft filled clouds, tonal depth, lime sun. Clouds bob and drift.",
  },
  {
    id: "contour",
    label: "B · Contour",
    note: "Line-drawn clouds that match the icon set. Wind lines move.",
  },
];

const now = 1_800_000_000_000;

function conversationRow(
  index: number,
  role: "user" | "assistant",
  text: string,
): TimelineRow {
  const base = {
    id: `row_${index}`,
    threadId: "thr_empty_story",
    turnId: `turn_${Math.floor(index / 2)}`,
    sourceSeqStart: index + 1,
    sourceSeqEnd: index + 1,
    startedAt: now + index * 1_000,
    createdAt: now + index * 1_000,
    kind: "conversation" as const,
    text,
    attachments: null,
  };
  if (role === "user") {
    return {
      ...base,
      role: "user",
      initiator: "user",
      senderThreadId: null,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
      mentions: [],
    };
  }
  return { ...base, role: "assistant", turnRequest: null };
}

const ROWS: TimelineRow[] = [
  conversationRow(0, "user", "Tidy up the settings page spacing."),
  conversationRow(
    1,
    "assistant",
    "Done. I aligned the section gaps to the 4px grid and kept the row heights unchanged.",
  ),
];

const THREAD_EMPTY = (
  <EmptyStateScene
    scene="threads"
    size="hero"
    title="No messages yet"
    description="Send a message below to start this thread."
    className="my-auto"
  />
);

function Frame({
  title,
  children,
  className,
  trailing,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {title}
        </span>
        {trailing}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function ProjectsExample({ empty }: { empty: boolean }) {
  return (
    <Frame
      title="Settings · Projects"
      className="min-h-[300px]"
      trailing={
        <Button variant="outline" size="sm">
          <Icon name="Plus" className="size-3.5" />
          Add a project
        </Button>
      }
    >
      {empty ? (
        <EmptyStateScene
          scene="projects"
          size="hero"
          title="No projects yet"
          description="Add a project to start running threads in a repository."
        />
      ) : (
        <ul className="divide-y divide-border px-3">
          {["cloudroom-gui", "marketing-site", "infra"].map((name) => (
            <li key={name} className="flex items-center gap-2 py-2.5 text-sm">
              <Icon name="Folder" className="size-4 text-muted-foreground" />
              {name}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function ThreadExample({
  empty,
  status = "idle",
  pending = false,
  error = false,
  working = false,
  hasOlder = false,
  reconnecting = false,
  title = "Thread · main view",
}: {
  empty: boolean;
  status?: ThreadRuntimeDisplayStatus;
  pending?: boolean;
  error?: boolean;
  working?: boolean;
  hasOlder?: boolean;
  reconnecting?: boolean;
  title?: string;
}) {
  return (
    <Frame title={title} className="h-[420px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-3">
        <ThreadTimelineSurface
          activeThinking={null}
          contextBoundarySeq={null}
          isThreadTimelinePending={pending}
          timelineError={error}
          showOngoingIndicator={working}
          hasOlderTimelineRows={hasOlder}
          onLoadOlderRows={() => {}}
          hostConnectionNotice={
            reconnecting
              ? { label: "Waiting for your Mac to reconnect", tone: "pending" }
              : null
          }
          timelineRows={empty ? [] : ROWS}
          threadId="thr_empty_story"
          threadRuntimeDisplayStatus={status}
          workspaceRootPath={undefined}
          emptyContent={THREAD_EMPTY}
        />
      </div>
      <div className="m-3 mt-0 rounded-xl border border-border bg-composer px-3 py-2.5 text-sm text-subtle-foreground">
        Ask anything…
      </div>
    </Frame>
  );
}

function SearchExample({ empty }: { empty: boolean }) {
  const query = empty ? "kubernetes migration" : "spacing";
  return (
    <Frame title="Search threads" className="min-h-[300px] bg-popover">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3 text-sm">
        <Icon name="Search" className="size-4 text-muted-foreground" />
        <span className="truncate">{query}</span>
      </div>
      {empty ? (
        <EmptyStateScene
          scene="search"
          role="status"
          title="No matching results"
          description={`Nothing matches “${query}”. Try fewer or different words.`}
          className="py-4"
        />
      ) : (
        <ul className="space-y-0.5 p-2">
          {[
            "unify CloudRoom GUI spacing",
            "Spacing inspect: timeline",
            "Settings page spacing pass",
          ].map((name) => (
            <li
              key={name}
              className="truncate rounded-md px-2 py-1.5 text-sm first:bg-state-hover"
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function DiffPanelExample({ empty }: { empty: boolean }) {
  return (
    <Frame title="Panel · Diff" className="min-h-[220px]">
      {empty ? (
        <div className="px-4 pt-2">
          <EmptyStateScene
            scene="panel"
            role="status"
            title="No changes"
            description="Nothing differs in this comparison."
          />
        </div>
      ) : (
        <ul className="space-y-1 px-3 py-2 font-mono text-xs">
          {["src/app.css", "src/components/ui/theme.css"].map((path) => (
            <li key={path} className="flex justify-between gap-2">
              <span className="truncate">{path}</span>
              <span className="text-diff-added">+12</span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function EmptyToggle({
  empty,
  onChange,
}: {
  empty: boolean;
  onChange: (empty: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Content"
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={empty === value}
          onClick={() => onChange(value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            empty === value
              ? "bg-state-active text-foreground"
              : "text-muted-foreground hover:bg-state-hover",
          )}
        >
          {value ? "Empty" : "Populated"}
        </button>
      ))}
    </div>
  );
}

function DirectionColumn({
  direction,
  empty,
}: {
  direction: (typeof DIRECTIONS)[number];
  empty: boolean;
}) {
  return (
    <CloudIllustrationVariantContext.Provider value={direction.id}>
      <div className="flex min-w-0 flex-col gap-3">
        <header>
          <h2 className="text-sm font-semibold text-foreground">
            {direction.label}
          </h2>
          <p className="text-xs text-muted-foreground">{direction.note}</p>
        </header>
        <ProjectsExample empty={empty} />
        <ThreadExample empty={empty} />
        <SearchExample empty={empty} />
        <DiffPanelExample empty={empty} />
      </div>
    </CloudIllustrationVariantContext.Provider>
  );
}

function useInitialEmpty(): boolean {
  if (typeof window === "undefined") return true;
  return (
    new URLSearchParams(window.location.search).get("content") !== "populated"
  );
}

export function Directions() {
  const [empty, setEmpty] = useState(useInitialEmpty);
  return (
    <main className="mx-auto w-full max-w-[64rem] space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Cloud empty states
          </h1>
          <p className="text-sm text-muted-foreground">
            Toggle content to see the populated-to-empty transition.
          </p>
        </div>
        <EmptyToggle empty={empty} onChange={setEmpty} />
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        {DIRECTIONS.map((direction) => (
          <DirectionColumn
            key={direction.id}
            direction={direction}
            empty={empty}
          />
        ))}
      </div>
    </main>
  );
}

function SingleDirection({ variant }: { variant: CloudIllustrationVariant }) {
  const [empty, setEmpty] = useState(useInitialEmpty);
  const direction = DIRECTIONS.find((item) => item.id === variant)!;
  return (
    <main className="mx-auto w-full max-w-[30rem] space-y-4 px-3 py-4">
      <div className="flex items-center justify-end">
        <EmptyToggle empty={empty} onChange={setEmpty} />
      </div>
      <DirectionColumn direction={direction} empty={empty} />
    </main>
  );
}

export function DirectionA() {
  return <SingleDirection variant="cumulus" />;
}

export function DirectionB() {
  return <SingleDirection variant="contour" />;
}

export function ThreadStateClassification() {
  const cases: readonly {
    title: string;
    props: Parameters<typeof ThreadExample>[0];
  }[] = [
    { title: "Loaded, no messages → clouds", props: { empty: true } },
    {
      title: "Loading → skeleton, no clouds",
      props: { empty: true, pending: true },
    },
    {
      title: "Load failed → error, no clouds",
      props: { empty: true, error: true },
    },
    {
      title: "Agent working → indicator, no clouds",
      props: { empty: true, working: true, status: "active" },
    },
    {
      title: "Older history not loaded → no clouds",
      props: { empty: true, hasOlder: true },
    },
    {
      title: "Host reconnecting → notice, no clouds",
      props: { empty: true, reconnecting: true, status: "host-reconnecting" },
    },
    {
      title: "Pending first turn → no clouds",
      props: { empty: true, status: "pending" },
    },
  ];
  return (
    <main className="mx-auto grid w-full max-w-[64rem] gap-4 px-4 py-5 md:grid-cols-2">
      {cases.map(({ title, props }) => (
        <ThreadExample key={title} {...props} title={title} />
      ))}
    </main>
  );
}
