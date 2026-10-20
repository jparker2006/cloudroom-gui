// THROWAWAY design-options story for the Artifacts tab (Phase 1b).
// Lives in .artifacts-work/ and is copied into apps/app/src only while rendering screenshots.
// Mock data only. Not production code.
import { useMemo, type ReactNode } from "react";
import { PanelGroup } from "react-resizable-panels";
import { Icon, type IconName } from "@cloudroom/shared-ui/icon";
import { Input } from "@cloudroom/shared-ui/input";
import { Button } from "@cloudroom/shared-ui/button";
import { EmptyStatePanel } from "@cloudroom/shared-ui/empty-state";
import { CHROME_SECTION_LABEL_CLASS } from "@cloudroom/shared-ui/chrome-style-tokens";
import { LIST_HOVER_TRANSITION } from "@cloudroom/shared-ui/motion";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { TooltipProvider } from "@cloudroom/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type PluginPageFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { ThreadSecondaryPanel } from "../ThreadSecondaryPanel";
import { resolveRightPanelFileIconName } from "../rightPanelFileVisuals";

export default { title: "zz-scratch/Artifacts options" };

const noop = () => {};

const TOUCH = "max-md:pointer-coarse:min-h-11";
const ROW_CLASS = `group flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left ${LIST_HOVER_TRANSITION} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${TOUCH}`;

type Label = "generated" | "modified" | "uploaded" | "referenced";
type Owner = "workspace" | "thread-storage" | "cloud-workspace" | "attachment" | "outside" | "unresolved";
type OccurrenceStatus = "ok" | "failed" | "pending" | "denied";
type FileType = "image" | "doc" | "code" | "data";
type Access = "allowed" | "unavailable" | "preview-unavailable" | "none";

interface Occurrence {
  id: string;
  verb: string;
  status: OccurrenceStatus;
  where: string;
  when: string;
  earlier?: boolean;
  nested?: string;
}

interface Artifact {
  id: string;
  name: string;
  dir: string;
  owner: Owner;
  type: FileType;
  labels: Label[];
  access: Access;
  occurrences: Occurrence[];
}

const ARTIFACTS: Artifact[] = [
  {
    id: "a1", name: "hero-banner.png", dir: "generated", owner: "thread-storage", type: "image", labels: ["generated"], access: "allowed",
    occurrences: [
      { id: "o1", verb: "Generated image", status: "ok", where: "Turn 6", when: "12m ago" },
      { id: "o2", verb: "Viewed image", status: "ok", where: "Turn 6", when: "11m ago" },
    ],
  },
  {
    id: "a2", name: "ThreadArtifacts.tsx", dir: "apps/app/src/components/secondary-panel", owner: "workspace", type: "code", labels: ["generated", "modified"], access: "allowed",
    occurrences: [
      { id: "o3", verb: "Created file", status: "ok", where: "Turn 3", when: "1h ago" },
      { id: "o4", verb: "Edited +18 −4", status: "ok", where: "Turn 5", when: "40m ago", nested: "Explore subagent" },
      { id: "o5", verb: "Edit failed", status: "failed", where: "Turn 6", when: "14m ago" },
      { id: "o5b", verb: "Edit denied", status: "denied", where: "Turn 6", when: "13m ago" },
      { id: "o6", verb: "Linked in reply", status: "ok", where: "Turn 6", when: "10m ago" },
    ],
  },
  {
    id: "a3", name: "README.md", dir: "Workspace root", owner: "workspace", type: "doc", labels: ["modified"], access: "allowed",
    occurrences: [{ id: "o7", verb: "Edited +6 −1", status: "ok", where: "Turn 2", when: "2h ago", earlier: true }],
  },
  {
    id: "a4", name: "README.md", dir: "notes", owner: "thread-storage", type: "doc", labels: ["generated"], access: "allowed",
    occurrences: [{ id: "o8", verb: "Created file", status: "ok", where: "Turn 4", when: "1h ago" }],
  },
  {
    id: "a5", name: "client.ts", dir: "src/api", owner: "workspace", type: "code", labels: ["modified"], access: "allowed",
    occurrences: [{ id: "o9", verb: "Moved from src/client.ts", status: "ok", where: "Turn 5", when: "38m ago" }],
  },
  {
    id: "a6", name: "launch-brief-1760….pdf", dir: "stored as launch-brief-1760…-k3x9q2.pdf", owner: "attachment", type: "doc", labels: ["uploaded"], access: "allowed",
    occurrences: [
      { id: "o10", verb: "Attached by you", status: "ok", where: "Message 1", when: "3h ago", earlier: true },
      { id: "o11", verb: "Read by agent", status: "ok", where: "Turn 1", when: "3h ago", earlier: true },
    ],
  },
  {
    id: "a7", name: "old-report.html", dir: "reports", owner: "thread-storage", type: "doc", labels: ["generated"], access: "unavailable",
    occurrences: [
      { id: "o12", verb: "Created file", status: "ok", where: "Turn 2", when: "2h ago", earlier: true },
      { id: "o13", verb: "Deleted", status: "ok", where: "Turn 5", when: "38m ago" },
    ],
  },
  {
    id: "a8", name: "q3-metrics.csv", dir: "/Users/sam/Downloads", owner: "outside", type: "data", labels: ["referenced"], access: "none",
    occurrences: [{ id: "o14", verb: "Referenced by path", status: "ok", where: "Message 2", when: "2h ago", earlier: true }],
  },
  {
    id: "a9", name: "logo.svg", dir: "assets/logo.svg (relative, no folder reported)", owner: "unresolved", type: "image", labels: ["referenced"], access: "none",
    occurrences: [{ id: "o15", verb: "Viewed image", status: "ok", where: "Turn 4", when: "1h ago" }],
  },
  {
    id: "a10", name: "summary.json", dir: "/workspace/dist", owner: "cloud-workspace", type: "data", labels: ["generated"], access: "preview-unavailable",
    occurrences: [{ id: "o16", verb: "Created file", status: "ok", where: "Turn 6", when: "9m ago" }],
  },
];

const LABEL_TEXT: Record<Label, string> = {
  generated: "Generated",
  modified: "Modified",
  uploaded: "Uploaded to this project",
  referenced: "Referenced",
};

const LABEL_TONE: Record<Label, string> = {
  generated: "text-success border-success/40",
  modified: "text-warning-text border-warning-text/40",
  uploaded: "text-file-accent border-file-accent/40",
  referenced: "text-muted-foreground border-border",
};

const OWNER_TEXT: Record<Owner, string> = {
  workspace: "Workspace",
  "thread-storage": "Thread storage",
  "cloud-workspace": "Cloud workspace",
  attachment: "Project attachment",
  outside: "Outside scope",
  unresolved: "Not verified",
};

const OWNER_ICON: Record<Owner, IconName> = {
  workspace: "Folder",
  "thread-storage": "Archive",
  "cloud-workspace": "Cloud",
  attachment: "Paperclip",
  outside: "Lock",
  unresolved: "CircleQuestion",
};

const TYPE_FILTERS: { id: FileType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "doc", label: "Docs" },
  { id: "code", label: "Code" },
  { id: "data", label: "Data" },
];

const CURRENT_FILE_COPY =
  "Opens what's on disk now. It may differ from when the agent wrote it. Each change listed here shows its own diff.";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function LabelTag({ label }: { label: Label }) {
  return (
    <span className={cn("inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-none", LABEL_TONE[label])}>
      {LABEL_TEXT[label]}
    </span>
  );
}

function OwnerTag({ owner }: { owner: Owner }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
      <Icon name={OWNER_ICON[owner]} className="size-3" aria-hidden />
      {OWNER_TEXT[owner]}
    </span>
  );
}

function StatusIcon({ status }: { status: OccurrenceStatus }) {
  switch (status) {
    case "ok":
      return <Icon name="CircleCheck" className="size-3.5 shrink-0 text-subtle-foreground" aria-label="Succeeded" />;
    case "failed":
      return <Icon name="CircleX" className="size-3.5 shrink-0 text-destructive-text" aria-label="Failed" />;
    case "pending":
      return <Icon name="Clock" className="size-3.5 shrink-0 text-warning-text" aria-label="Pending" />;
    case "denied":
      return <Icon name="Unavailable" className="size-3.5 shrink-0 text-destructive-text" aria-label="Denied" />;
  }
}

function AccessNote({ artifact }: { artifact: Artifact }) {
  const note =
    artifact.access === "unavailable"
      ? { icon: "FileQuestion", text: "Not available now. It may have been moved or deleted, or it's outside this thread's files.", tone: "text-destructive-text" }
      : artifact.access === "preview-unavailable"
        ? { icon: "CloudOff", text: "Preview unavailable for cloud files yet", tone: "text-muted-foreground" }
        : artifact.owner === "outside"
          ? { icon: "Lock", text: "Outside this thread's workspace and storage", tone: "text-muted-foreground" }
          : artifact.owner === "unresolved"
            ? { icon: "CircleQuestion", text: "Not verified: the agent didn't report which folder this is in", tone: "text-muted-foreground" }
            : null;
  if (note === null) return null;
  return (
    <span className={cn("flex items-start gap-1 text-[11px] leading-4", note.tone)}>
      <Icon name={note.icon} className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{note.text}</span>
    </span>
  );
}

function FileIcon({ artifact }: { artifact: Artifact }) {
  const name =
    artifact.type === "image"
      ? "Image"
      : artifact.name.endsWith(".pdf")
        ? "FileText"
        : artifact.type === "data"
          ? "FileSpreadsheet"
          : resolveRightPanelFileIconName(`${artifact.dir}/${artifact.name}`);
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
      <Icon name={name} className="size-3.5" aria-hidden />
    </span>
  );
}

function SearchAndFilters({ query, type }: { query: string; type: FileType | "all" }) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      <div className="relative min-w-0">
        <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          readOnly
          value={query}
          aria-label="Search artifacts by file name"
          placeholder="Search artifacts"
          className="h-8 pl-8 text-sm max-md:pointer-coarse:h-11"
        />
      </div>
      <div role="group" aria-label="File type" className="flex gap-1 overflow-x-auto">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={filter.id === type}
            className={cn(
              "h-7 shrink-0 rounded-md px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-11 max-md:pointer-coarse:px-3.5",
              LIST_HOVER_TRANSITION,
              filter.id === type ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Coverage = "partial" | "complete" | "checking" | "context-clear";

function CoverageNote({ coverage }: { coverage: Coverage }) {
  if (coverage === "complete") {
    return (
      <div className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-subtle-foreground">
        <Icon name="CircleCheck" className="size-3" aria-hidden />
        Checked every turn in this thread.
      </div>
    );
  }
  if (coverage === "checking") {
    return (
      <div role="status" className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon name="Spinner" className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
        Checking earlier turns… 3 pages loaded
      </div>
    );
  }
  return (
    <div role="status" className="mx-3 mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface-recessed px-2.5 py-2 text-xs">
      {coverage === "partial" ? (
        <div className="flex items-start gap-2">
          <Icon name="Clock" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-foreground">Partial history</div>
            <div className="text-muted-foreground">Checked 18 turns so far. Earlier turns may contain more files.</div>
          </div>
          <Button type="button" variant="outline" size="sm" className={cn("h-7 shrink-0 px-2 text-xs", TOUCH)}>
            Check earlier
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Icon name="Info" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 text-muted-foreground">
            <span className="text-foreground">Checked every turn since the context was cleared. </span>
            History before the context was cleared isn't available here.
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ count }: { count: number }) {
  return (
    <div className={cn("flex items-baseline gap-2 px-3 pb-1 pt-3", CHROME_SECTION_LABEL_CLASS)}>
      <span>Files from this thread</span>
      <span className="text-subtle-foreground">{count}</span>
    </div>
  );
}

function OccurrenceRow({ occurrence, fileName }: { occurrence: Occurrence; fileName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-1 pl-7 pr-1 text-xs">
      <span><StatusIcon status={occurrence.status} /></span>
      <div className="min-w-0 flex-1">
        <span className={cn(occurrence.status === "failed" || occurrence.status === "denied" ? "text-destructive-text" : "text-foreground")}>
          {occurrence.verb}
        </span>
        <span className="text-muted-foreground">
          {" · "}
          {occurrence.where}
          {occurrence.nested ? ` · inside ${occurrence.nested}` : ""}
          {occurrence.earlier ? " · earlier page" : ""}
          {" · "}
          {occurrence.when}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Jump to “${occurrence.verb}” for ${fileName} in ${occurrence.where}`}
        className={cn("flex shrink-0 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:min-w-11", TOUCH)}
      >
        <Icon name="CornerDownRight" className="size-3" aria-hidden />
        <span className="text-[11px]">Jump</span>
      </button>
    </div>
  );
}

function FileActions({ artifact, layout = "inline" }: { artifact: Artifact; layout?: "inline" | "detail" }) {
  if (artifact.access !== "allowed") return null;
  return (
    <div className={cn("flex flex-col gap-1.5", layout === "inline" ? "py-1.5 pl-7 pr-2" : "")}>
      <p className="text-[11px] leading-4 text-muted-foreground">{artifact.owner === "attachment" ? "Opens the stored upload as it is now." : CURRENT_FILE_COPY}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant={layout === "detail" ? "default" : "outline"} className={cn("h-7 px-2.5 text-xs", TOUCH)}>
          <Icon name="ArrowUpRight" className="size-3.5" />
          Open current file
        </Button>
        <Button type="button" size="sm" variant="outline" className={cn("h-7 px-2.5 text-xs", TOUCH)}>
          <Icon name="Download" className="size-3.5" />
          Download
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Option A ---------------- */

function OptionARow({ artifact, expanded }: { artifact: Artifact; expanded: boolean }) {
  const count = artifact.occurrences.length;
  return (
    <li className="px-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`Sources for ${artifact.name}, ${plural(count, "source")}`}
        className={cn(ROW_CLASS, "items-start hover:bg-state-hover", expanded && "bg-state-hover")}
      >
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="mt-0.5"><FileIcon artifact={artifact} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-foreground">{artifact.name}</span>
            {artifact.labels.map((label) => <LabelTag key={label} label={label} />)}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <OwnerTag owner={artifact.owner} />
            <span className="min-w-0 truncate text-[11px] text-subtle-foreground">{artifact.dir}</span>
          </span>
          <AccessNote artifact={artifact} />
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{plural(count, "source")}</span>
      </button>
      {expanded ? (
        <div className="mb-1 ml-2 border-l border-border pl-1">
          {artifact.occurrences.map((o) => <OccurrenceRow key={o.id} occurrence={o} fileName={artifact.name} />)}
          <FileActions artifact={artifact} />
        </div>
      ) : null}
    </li>
  );
}

type PanelState = "default" | "filtered" | "empty" | "no-results" | "loading" | "error" | "context-clear" | "statuses";

function useStateData(state: PanelState) {
  return useMemo(() => {
    switch (state) {
      case "filtered":
        return { query: "readme", type: "doc" as const, items: ARTIFACTS.filter((a) => a.name === "README.md") };
      case "no-results":
        return { query: "invoice", type: "all" as const, items: [] };
      case "statuses":
        return { query: "", type: "all" as const, items: ARTIFACTS.filter((a) => ["a6", "a7", "a8", "a9", "a10"].includes(a.id)) };
      case "context-clear":
        return { query: "", type: "all" as const, items: ARTIFACTS.slice(0, 2) };
      default:
        return { query: "", type: "all" as const, items: ARTIFACTS };
    }
  }, [state]);
}

function StateBody({ state, query, children }: { state: PanelState; query: string; children: ReactNode }) {
  if (state === "loading") {
    return (
      <div role="status" className="flex flex-col gap-2 px-3 pt-4" aria-label="Loading artifacts">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Spinner" className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Finding files in this thread…
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5">
            <div className="size-3.5 rounded bg-state-hover" />
            <div className="h-3 rounded bg-state-hover" style={{ width: `${55 - i * 8}%` }} />
          </div>
        ))}
      </div>
    );
  }
  if (state === "error") {
    return (
      <EmptyStatePanel className="mx-3 mt-3" role="alert">
        <div className="text-foreground">Couldn't load this thread's history</div>
        <div className="mt-1 text-xs">Artifacts are found from the conversation. Try again in a moment.</div>
        <Button type="button" variant="outline" size="sm" className={cn("mt-3 h-7 px-2.5 text-xs", TOUCH)}>
          <Icon name="RotateCcw" className="size-3.5" />
          Retry
        </Button>
      </EmptyStatePanel>
    );
  }
  if (state === "empty") {
    return (
      <EmptyStatePanel className="mx-3 mt-3">
        <div className="text-foreground">No files yet</div>
        <div className="mt-1 text-xs">Files the agent creates, edits, reads or links, and files you attach, show up here.</div>
      </EmptyStatePanel>
    );
  }
  if (state === "no-results") {
    return (
      <EmptyStatePanel className="mx-3 mt-3">
        No files match “{query}”.
        <div className="mt-1 text-xs">Only turns checked so far are searched.</div>
      </EmptyStatePanel>
    );
  }
  return <>{children}</>;
}

function coverageFor(state: PanelState): Coverage | null {
  if (state === "loading" || state === "error") return null;
  if (state === "empty") return "complete";
  if (state === "context-clear") return "context-clear";
  return "partial";
}

function OptionAContent({ state = "default", expandedIds = ["a2"] }: { state?: PanelState; expandedIds?: string[] }) {
  const { query, type, items } = useStateData(state);
  const coverage = coverageFor(state);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
      <SearchAndFilters query={query} type={type} />
      {coverage ? <CoverageNote coverage={coverage} /> : null}
      <StateBody state={state} query={query}>
        <SectionLabel count={items.length} />
        <ul>
          {items.map((a) => <OptionARow key={a.id} artifact={a} expanded={expandedIds.includes(a.id)} />)}
        </ul>
      </StateBody>
    </div>
  );
}

/* ---------------- Option B ---------------- */

function OptionBListRow({ artifact, selected }: { artifact: Artifact; selected: boolean }) {
  const count = artifact.occurrences.length;
  return (
    <li className="px-1">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`${artifact.name}, ${OWNER_TEXT[artifact.owner]}, ${plural(count, "source")}`}
        className={cn(ROW_CLASS, "hover:bg-state-hover", selected && "bg-state-active")}
      >
        <FileIcon artifact={artifact} />
        <span className="min-w-0 truncate text-sm text-foreground">{artifact.name}</span>
        <span className="min-w-0 truncate text-xs text-subtle-foreground">{OWNER_TEXT[artifact.owner]}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {artifact.access === "unavailable" ? <span className="text-[11px] text-destructive-text">Not available now</span> : null}
          {artifact.access === "preview-unavailable" ? <span className="text-[11px] text-muted-foreground">Preview unavailable</span> : null}
          {artifact.labels.slice(0, 1).map((l) => <LabelTag key={l} label={l} />)}
          <span className="text-[11px] text-muted-foreground">{count}</span>
        </span>
      </button>
    </li>
  );
}

function OptionBDetail({ artifact, showBack = false }: { artifact: Artifact; showBack?: boolean }) {
  return (
    <section aria-label={`${artifact.name} details`} className="flex min-h-0 flex-col gap-2 px-3 py-3">
      {showBack ? (
        <button type="button" className={cn("flex items-center gap-1 self-start rounded text-xs text-muted-foreground", TOUCH)}>
          <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
          All artifacts
        </button>
      ) : null}
      <div className="flex items-start gap-2">
        <FileIcon artifact={artifact} />
        <div className="min-w-0 flex-1">
          <h3 className="break-all text-sm font-medium text-foreground">{artifact.name}</h3>
          <div className="break-all text-xs text-muted-foreground">{artifact.dir}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <OwnerTag owner={artifact.owner} />
        {artifact.labels.map((l) => <LabelTag key={l} label={l} />)}
      </div>
      <AccessNote artifact={artifact} />
      {artifact.access === "allowed" ? (
        <div className="rounded-md border border-border bg-surface-recessed px-2.5 py-2">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs text-foreground">
            <Icon name="Info" className="size-3.5" aria-hidden />
            Current file
          </div>
          <FileActions artifact={artifact} layout="detail" />
        </div>
      ) : null}
      <div className={cn("pt-2", CHROME_SECTION_LABEL_CLASS)}>
        Sources in this thread <span className="text-subtle-foreground">{artifact.occurrences.length}</span>
      </div>
      <ol className="-ml-6 -mr-2">
        {artifact.occurrences.map((o) => (
          <li key={o.id}><OccurrenceRow occurrence={o} fileName={artifact.name} /></li>
        ))}
      </ol>
    </section>
  );
}

function OptionBContent({ state = "default", layout = "split", selectedId = "a2" }: { state?: PanelState; layout?: "split" | "list" | "detail"; selectedId?: string }) {
  const { query, type, items } = useStateData(state);
  const selected = ARTIFACTS.find((a) => a.id === selectedId)!;
  const coverage = coverageFor(state);
  if (layout === "detail") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <OptionBDetail artifact={selected} showBack />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex min-h-0 flex-col overflow-y-auto pb-2", layout === "split" ? "max-h-[50%] border-b border-border" : "flex-1")}>
        <SearchAndFilters query={query} type={type} />
        {coverage ? <CoverageNote coverage={coverage} /> : null}
        <StateBody state={state} query={query}>
          <SectionLabel count={items.length} />
          <ul>
            {items.map((a) => <OptionBListRow key={a.id} artifact={a} selected={layout === "split" && a.id === selected.id} />)}
          </ul>
        </StateBody>
      </div>
      {layout === "split" && state === "default" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OptionBDetail artifact={selected} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- harness ---------------- */

const ARTIFACTS_TAB: PluginPageFixedPanelTab = {
  fixedTabId: "artifacts",
  id: "core:artifacts",
  kind: "plugin-page-fixed",
  pageId: "artifacts",
  pluginId: "core",
};

function PanelShell({ children, drawer = false }: { children: ReactNode; drawer?: boolean }) {
  const infoTab = createThreadInfoFixedPanelTab();
  const diffTab = createGitDiffFixedPanelTab();
  return (
    <ThreadSecondaryPanel
      activeTab={ARTIFACTS_TAB}
      canUseGitUi
      requestedMergeBaseBranch="main"
      environmentId={undefined}
      isOpen
      metadataContent={null}
      tabs={[]}
      fixedTabs={[
        { ariaLabel: "Show thread info panel", label: "Info", leadingVisual: <Icon name="Info" />, onSelect: noop, tab: infoTab, title: "Thread info" },
        { ariaLabel: "Show diff panel", label: "Diff", leadingVisual: <Icon name="FileDiff" />, onSelect: noop, tab: diffTab, title: "Diff" },
        {
          ariaLabel: "Show artifacts panel",
          label: "Artifacts",
          leadingVisual: <Icon name="Layers" />,
          onSelect: noop,
          tab: ARTIFACTS_TAB,
          title: "Artifacts",
          contentFillsRegion: true,
          renderContent: () => <div className="flex min-h-0 flex-1 flex-col">{children}</div>,
        },
      ]}
      onPanelFocus={noop}
      onCollapse={noop}
      onClose={noop}
      onTabReorder={noop}
      onOpenNewTab={noop}
      isConversationCollapsed
      onToggleConversationCollapse={noop}
      renderAsDrawer={drawer}
      inlinePanelToggle="hidden"
      showConversationCollapseControl={false}
    />
  );
}

function Stage({ label, children, height = 820 }: { label: string; children: ReactNode; height?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="w-[440px] text-xs text-muted-foreground">{label}</div>
      <div className="flex w-[440px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background" style={{ height }}>
        <PanelGroup direction="horizontal">
          <PanelShell>{children}</PanelShell>
        </PanelGroup>
      </div>
    </div>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false} className="min-h-0">
        {children}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-wrap content-start gap-4 bg-background p-4">{children}</div>
    </Providers>
  );
}

function MobileStage({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="fixed inset-0 flex flex-col bg-background">
        <PanelGroup direction="horizontal">
          <PanelShell drawer>{children}</PanelShell>
        </PanelGroup>
      </div>
    </Providers>
  );
}

const SMALL = 400;

export function OptionADesktop() {
  return (
    <Grid>
      <Stage label="A · default: partial history, one file expanded (failed + denied edits as occurrences)"><OptionAContent /></Stage>
      <Stage label="A · statuses: uploaded, Deleted + Not available now, outside scope, not verified, cloud preview unavailable">
        <OptionAContent state="statuses" expandedIds={["a7", "a10"]} />
      </Stage>
      <div className="flex flex-col gap-4">
        <Stage label="A · initial loading" height={SMALL}><OptionAContent state="loading" /></Stage>
        <Stage label="A · history fetch error" height={SMALL}><OptionAContent state="error" /></Stage>
      </div>
      <Stage label="A · search “readme” + Docs (same basename, different owner)" height={SMALL}><OptionAContent state="filtered" expandedIds={[]} /></Stage>
      <Stage label="A · context cleared (complete since the clear)" height={SMALL}><OptionAContent state="context-clear" expandedIds={[]} /></Stage>
      <div className="flex flex-col gap-4">
        <Stage label="A · no artifacts (complete)" height={SMALL / 2 + 100}><OptionAContent state="empty" /></Stage>
        <Stage label="A · no search results" height={SMALL / 2 + 100}><OptionAContent state="no-results" /></Stage>
      </div>
    </Grid>
  );
}

export function OptionAMobile() {
  return <MobileStage><OptionAContent /></MobileStage>;
}

export function OptionAMobileStatuses() {
  return <MobileStage><OptionAContent state="statuses" expandedIds={["a6", "a7"]} /></MobileStage>;
}

export function OptionBDesktop() {
  return (
    <Grid>
      <Stage label="B · list + detail (repeated file; failed + denied edits)"><OptionBContent /></Stage>
      <Stage label="B · statuses in list"><OptionBContent state="statuses" layout="list" /></Stage>
      <div className="flex flex-col gap-4">
        <Stage label="B · initial loading" height={SMALL}><OptionBContent state="loading" layout="list" /></Stage>
        <Stage label="B · history fetch error" height={SMALL}><OptionBContent state="error" layout="list" /></Stage>
      </div>
      <Stage label="B · detail: cloud file (preview unavailable)" height={SMALL}><OptionBContent layout="detail" selectedId="a10" /></Stage>
      <Stage label="B · detail: deleted earlier, not available now" height={SMALL}><OptionBContent layout="detail" selectedId="a7" /></Stage>
      <div className="flex flex-col gap-4">
        <Stage label="B · context cleared" height={SMALL / 2 + 100}><OptionBContent state="context-clear" layout="list" /></Stage>
        <Stage label="B · no search results" height={SMALL / 2 + 100}><OptionBContent state="no-results" layout="list" /></Stage>
      </div>
    </Grid>
  );
}

export function OptionBMobileList() {
  return <MobileStage><OptionBContent layout="list" /></MobileStage>;
}

export function OptionBMobileDetail() {
  return <MobileStage><OptionBContent layout="detail" /></MobileStage>;
}
