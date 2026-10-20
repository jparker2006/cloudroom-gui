// THROWAWAY design-options story for the Artifacts tab (Phase 1).
// Lives in .artifacts-work/ and is copied into apps/app/src only while rendering screenshots.
// Mock data only. Not production code.
import { useMemo, useState, type ReactNode } from "react";
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
import { LAUNCHER_ROW_BASE_CLASS, LAUNCHER_ROW_ICON_CLASS } from "../launcherRow";

export default { title: "zz-scratch/Artifacts options" };

const noop = () => {};

type Provenance = "generated" | "modified" | "uploaded" | "referenced";
type Owner = "workspace" | "thread-storage" | "cloud-workspace" | "attachment" | "outside";
type OccurrenceStatus = "ok" | "failed" | "pending" | "denied";
type FileType = "image" | "doc" | "code" | "data" | "other";

interface Occurrence {
  id: string;
  verb: string;
  status: OccurrenceStatus;
  where: string;
  when: string;
  seq: number;
  olderPage?: boolean;
  nested?: string;
}

interface Artifact {
  id: string;
  name: string;
  dir: string;
  owner: Owner;
  type: FileType;
  labels: Provenance[];
  occurrences: Occurrence[];
  availability: "available" | "missing" | "out-of-scope";
  scopeReason?: string;
}

const ARTIFACTS: Artifact[] = [
  {
    id: "a1",
    name: "hero-banner.png",
    dir: "generated",
    owner: "thread-storage",
    type: "image",
    labels: ["generated"],
    availability: "available",
    occurrences: [
      { id: "o1", verb: "Generated image", status: "ok", where: "Turn 6", when: "12m ago", seq: 812 },
      { id: "o2", verb: "Viewed image", status: "ok", where: "Turn 6", when: "11m ago", seq: 815 },
    ],
  },
  {
    id: "a2",
    name: "ThreadArtifacts.tsx",
    dir: "apps/app/src/components/secondary-panel",
    owner: "workspace",
    type: "code",
    labels: ["generated", "modified"],
    availability: "available",
    occurrences: [
      { id: "o3", verb: "Created file", status: "ok", where: "Turn 3", when: "1h ago", seq: 402 },
      { id: "o4", verb: "Edited +18 −4", status: "ok", where: "Turn 5 · subagent", when: "40m ago", seq: 655, nested: "Explore subagent" },
      { id: "o5", verb: "Edit failed", status: "failed", where: "Turn 6", when: "14m ago", seq: 790 },
      { id: "o6", verb: "Linked in reply", status: "ok", where: "Turn 6", when: "10m ago", seq: 840 },
    ],
  },
  {
    id: "a3",
    name: "README.md",
    dir: "Workspace root",
    owner: "workspace",
    type: "doc",
    labels: ["modified"],
    availability: "available",
    occurrences: [
      { id: "o7", verb: "Edited +6 −1", status: "ok", where: "Turn 2", when: "2h ago", seq: 210, olderPage: true },
    ],
  },
  {
    id: "a4",
    name: "README.md",
    dir: "notes",
    owner: "thread-storage",
    type: "doc",
    labels: ["generated"],
    availability: "available",
    occurrences: [
      { id: "o8", verb: "Created file", status: "ok", where: "Turn 4", when: "1h ago", seq: 530 },
    ],
  },
  {
    id: "a5",
    name: "launch-brief.pdf",
    dir: "Uploaded with your message",
    owner: "attachment",
    type: "doc",
    labels: ["uploaded"],
    availability: "available",
    occurrences: [
      { id: "o9", verb: "Attached by you", status: "ok", where: "Message 1", when: "3h ago", seq: 4, olderPage: true },
      { id: "o10", verb: "Read by agent", status: "ok", where: "Turn 1", when: "3h ago", seq: 31, olderPage: true },
    ],
  },
  {
    id: "a6",
    name: "q3-metrics.csv",
    dir: "/Users/sam/Downloads",
    owner: "outside",
    type: "data",
    labels: ["referenced"],
    availability: "out-of-scope",
    scopeReason: "Outside this thread's workspace and storage",
    occurrences: [
      { id: "o11", verb: "Attached by path", status: "ok", where: "Message 2", when: "2h ago", seq: 120, olderPage: true },
    ],
  },
  {
    id: "a7",
    name: "old-report.html",
    dir: "reports",
    owner: "thread-storage",
    type: "doc",
    labels: ["generated"],
    availability: "missing",
    occurrences: [
      { id: "o12", verb: "Created file", status: "ok", where: "Turn 2", when: "2h ago", seq: 230, olderPage: true },
      { id: "o13", verb: "Deleted file", status: "ok", where: "Turn 5", when: "38m ago", seq: 690 },
    ],
  },
  {
    id: "a8",
    name: "deploy.config.json",
    dir: "infra",
    owner: "workspace",
    type: "data",
    labels: [],
    availability: "available",
    occurrences: [
      { id: "o14", verb: "Write failed", status: "failed", where: "Turn 6", when: "13m ago", seq: 801 },
      { id: "o15", verb: "Waiting for approval", status: "pending", where: "Turn 7", when: "now", seq: 880 },
    ],
  },
];

const LABEL_TEXT: Record<Provenance, string> = {
  generated: "Generated",
  modified: "Modified",
  uploaded: "Uploaded",
  referenced: "Referenced",
};

const OWNER_TEXT: Record<Owner, string> = {
  workspace: "Workspace",
  "thread-storage": "Thread storage",
  "cloud-workspace": "Cloud workspace",
  attachment: "Attachment",
  outside: "Outside scope",
};

const OWNER_ICON: Record<Owner, IconName> = {
  workspace: "Folder",
  "thread-storage": "Archive",
  "cloud-workspace": "Cloud",
  attachment: "Paperclip",
  outside: "Lock",
};

const TYPE_FILTERS: { id: FileType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "doc", label: "Docs" },
  { id: "code", label: "Code" },
  { id: "data", label: "Data" },
];

const LABEL_TONE: Record<Provenance, string> = {
  generated: "text-success border-success/40",
  modified: "text-warning-text border-warning-text/30",
  uploaded: "text-file-accent border-file-accent/40",
  referenced: "text-muted-foreground border-border",
};

function ProvenanceTag({ label }: { label: Provenance }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-medium leading-none",
        LABEL_TONE[label],
      )}
    >
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
      return <Icon name="CircleCheck" className="size-3.5 text-subtle-foreground" aria-label="Succeeded" />;
    case "failed":
      return <Icon name="CircleX" className="size-3.5 text-destructive-text" aria-label="Failed" />;
    case "pending":
      return <Icon name="Clock" className="size-3.5 text-warning-text" aria-label="Pending" />;
    case "denied":
      return <Icon name="Unavailable" className="size-3.5 text-destructive-text" aria-label="Denied" />;
  }
}

function AvailabilityNote({ artifact }: { artifact: Artifact }) {
  if (artifact.availability === "missing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive-text">
        <Icon name="FileQuestion" className="size-3" aria-hidden />
        File no longer exists
      </span>
    );
  }
  if (artifact.availability === "out-of-scope") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon name="Lock" className="size-3" aria-hidden />
        {artifact.scopeReason}
      </span>
    );
  }
  if (artifact.labels.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive-text">
        <Icon name="AlertTriangle" className="size-3" aria-hidden />
        No successful write
      </span>
    );
  }
  return null;
}

function SearchAndFilters({
  query,
  type,
  compact = false,
}: {
  query: string;
  type: FileType | "all";
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      <div className="relative min-w-0">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          readOnly
          value={query}
          aria-label="Search artifacts by file name"
          placeholder="Search artifacts"
          className="h-8 pl-8 text-sm focus-visible:ring-0"
        />
      </div>
      <div
        role="radiogroup"
        aria-label="File type"
        className={cn("flex gap-1", compact ? "overflow-x-auto" : "flex-wrap")}
      >
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            role="radio"
            aria-checked={filter.id === type}
            className={cn(
              "h-6 shrink-0 rounded-md px-2 text-xs",
              LIST_HOVER_TRANSITION,
              filter.id === type
                ? "bg-state-active text-foreground"
                : "text-muted-foreground hover:bg-state-hover",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CoverageBanner({ variant = "partial" }: { variant?: "partial" | "complete" | "loading" }) {
  if (variant === "complete") {
    return (
      <div className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-subtle-foreground">
        <Icon name="CircleCheck" className="size-3" aria-hidden />
        Checked all 26 turns in this thread
      </div>
    );
  }
  if (variant === "loading") {
    return (
      <div className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon name="Spinner" className="size-3 animate-spin" aria-hidden />
        Checking 8 earlier turns…
      </div>
    );
  }
  return (
    <div
      role="status"
      className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-border bg-surface-recessed px-2.5 py-2 text-xs"
    >
      <Icon name="Clock" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-foreground">Partial history</div>
        <div className="text-muted-foreground">
          Checked 18 of 26 turns. Earlier turns may contain more files.
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 px-2 text-xs">
        Check earlier
      </Button>
    </div>
  );
}

function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className={cn("flex items-baseline gap-2 px-3 pb-1 pt-3", CHROME_SECTION_LABEL_CLASS)}>
      <span>{children}</span>
      {count !== undefined ? <span className="text-subtle-foreground">{count}</span> : null}
    </div>
  );
}

function FileIcon({ artifact }: { artifact: Artifact }) {
  return (
    <span className={LAUNCHER_ROW_ICON_CLASS}>
      <Icon
        name={
          artifact.type === "image"
            ? "Image"
            : artifact.name.endsWith(".pdf")
              ? "FileText"
              : artifact.type === "data"
                ? "FileSpreadsheet"
                : resolveRightPanelFileIconName(`${artifact.dir}/${artifact.name}`)
        }
        className="size-3.5"
        aria-hidden
      />
    </span>
  );
}

function OccurrenceRow({ occurrence, indent = true }: { occurrence: Occurrence; indent?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        LAUNCHER_ROW_BASE_CLASS,
        "py-1 text-xs hover:bg-state-hover",
        indent && "pl-7",
      )}
      aria-label={`${occurrence.verb}, ${occurrence.where}. Jump to source in conversation`}
    >
      <StatusIcon status={occurrence.status} />
      <span
        className={cn(
          "min-w-0 truncate",
          occurrence.status === "failed" ? "text-destructive-text" : "text-foreground",
        )}
      >
        {occurrence.verb}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">
        {occurrence.where}
        {occurrence.olderPage ? " · earlier" : ""}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
        {occurrence.when}
        <Icon name="CornerDownRight" className="size-3" aria-hidden />
      </span>
    </button>
  );
}

/* ---------------- Option A: grouped list, inline expandable occurrences ---------------- */

function OptionARow({ artifact, expanded }: { artifact: Artifact; expanded: boolean }) {
  const dimmed = artifact.availability === "missing";
  return (
    <li className="px-1">
      <div className={cn(LAUNCHER_ROW_BASE_CLASS, "items-start hover:bg-state-hover", expanded && "bg-state-hover")}>
        <button type="button" aria-expanded={expanded} aria-label={`Show ${artifact.occurrences.length} sources`} className="mt-0.5 text-muted-foreground">
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3" />
        </button>
        <FileIcon artifact={artifact} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 truncate text-sm", dimmed ? "text-muted-foreground line-through decoration-subtle-foreground" : "text-foreground")}>
              {artifact.name}
            </span>
            {artifact.labels.map((label) => (
              <ProvenanceTag key={label} label={label} />
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <OwnerTag owner={artifact.owner} />
            <span className="min-w-0 truncate text-[11px] text-subtle-foreground">{artifact.dir}</span>
          </div>
          <AvailabilityNote artifact={artifact} />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {artifact.occurrences.length > 1 ? `${artifact.occurrences.length} sources` : artifact.occurrences[0]?.when}
        </span>
      </div>
      {expanded ? (
        <div className="mb-1 ml-2 border-l border-border pl-1">
          {artifact.occurrences.map((occurrence) => (
            <OccurrenceRow key={occurrence.id} occurrence={occurrence} />
          ))}
          {artifact.availability === "available" ? (
            <div className="flex items-center gap-1 py-1 pl-7 pr-2">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                <Icon name="ArrowUpRight" className="size-3" />
                Open current file
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                <Icon name="Download" className="size-3" />
                Download
              </Button>
              <span className="ml-auto truncate text-[11px] text-subtle-foreground">
                May differ from when the agent wrote it
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function OptionAContent({ state = "default", compact = false }: { state?: PanelState; compact?: boolean }) {
  const { query, type, items } = useStateData(state);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
      <SearchAndFilters query={query} type={type} compact={compact} />
      {state === "empty" ? null : <CoverageBanner variant={state === "loading" ? "loading" : "partial"} />}
      <StateBody state={state} query={query}>
        <SectionLabel count={items.length}>Files from this thread</SectionLabel>
        <ul>
          {items.map((artifact) => (
            <OptionARow key={artifact.id} artifact={artifact} expanded={artifact.id === "a2" || artifact.id === "a8"} />
          ))}
        </ul>
      </StateBody>
    </div>
  );
}

/* ---------------- Option B: compact list + detail view ---------------- */

function OptionBListRow({ artifact, selected }: { artifact: Artifact; selected: boolean }) {
  const dimmed = artifact.availability === "missing";
  return (
    <li className="px-1">
      <button
        type="button"
        aria-current={selected}
        className={cn(LAUNCHER_ROW_BASE_CLASS, "hover:bg-state-hover", selected && "bg-state-active")}
      >
        <FileIcon artifact={artifact} />
        <span className={cn("min-w-0 truncate text-sm", dimmed ? "text-muted-foreground line-through decoration-subtle-foreground" : "text-foreground")}>
          {artifact.name}
        </span>
        <span className="min-w-0 truncate text-xs text-subtle-foreground">{OWNER_TEXT[artifact.owner]}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {artifact.labels.slice(0, 1).map((label) => (
            <ProvenanceTag key={label} label={label} />
          ))}
          {artifact.labels.length === 0 ? (
            <Icon name="AlertTriangle" className="size-3 text-destructive-text" aria-label="No successful write" />
          ) : null}
          {artifact.occurrences.length > 1 ? (
            <span className="text-[11px] text-muted-foreground">×{artifact.occurrences.length}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function OptionBDetail({ artifact, showBack = false }: { artifact: Artifact; showBack?: boolean }) {
  return (
    <div className="flex min-h-0 flex-col gap-2 px-3 py-3">
      {showBack ? (
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name="ChevronLeft" className="size-3.5" />
          All artifacts
        </button>
      ) : null}
      <div className="flex items-start gap-2">
        <FileIcon artifact={artifact} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{artifact.name}</div>
          <div className="truncate text-xs text-muted-foreground">{artifact.dir}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <OwnerTag owner={artifact.owner} />
        {artifact.labels.map((label) => (
          <ProvenanceTag key={label} label={label} />
        ))}
      </div>
      <div className="rounded-md border border-border bg-surface-recessed px-2.5 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 text-foreground">
          <Icon name="Info" className="size-3.5" aria-hidden />
          Current file
        </div>
        Opens what's on disk now. It may differ from when the agent wrote it. Each change below shows its own diff.
      </div>
      <div className="flex gap-1.5">
        <Button type="button" size="sm" className="h-7 px-2.5 text-xs">
          <Icon name="ArrowUpRight" className="size-3.5" />
          Open current file
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs">
          <Icon name="Download" className="size-3.5" />
          Download
        </Button>
      </div>
      <div className={cn("pt-2", CHROME_SECTION_LABEL_CLASS)}>
        Sources in this thread <span className="text-subtle-foreground">{artifact.occurrences.length}</span>
      </div>
      <ol className="-mx-2">
        {artifact.occurrences.map((occurrence) => (
          <li key={occurrence.id}>
            <OccurrenceRow occurrence={occurrence} indent={false} />
            {occurrence.nested ? (
              <div className="pl-8 text-[11px] text-subtle-foreground">Inside {occurrence.nested}</div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function OptionBContent({ state = "default", layout = "split" }: { state?: PanelState; layout?: "split" | "list" | "detail" }) {
  const { query, type, items } = useStateData(state);
  const selected = ARTIFACTS[1]!;
  if (layout === "detail") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <OptionBDetail artifact={selected} showBack />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex min-h-0 flex-col overflow-y-auto pb-2", layout === "split" ? "max-h-[48%] border-b border-border" : "flex-1")}>
        <SearchAndFilters query={query} type={type} compact={layout === "list"} />
        {state === "empty" ? null : <CoverageBanner variant={state === "loading" ? "loading" : "partial"} />}
        <StateBody state={state} query={query}>
          <SectionLabel count={items.length}>Files from this thread</SectionLabel>
          <ul>
            {items.map((artifact) => (
              <OptionBListRow key={artifact.id} artifact={artifact} selected={layout === "split" && artifact.id === selected.id} />
            ))}
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

/* ---------------- Option C: chronological source feed ---------------- */

const FEED: { title: string; meta: string; older?: boolean; entries: { artifact: Artifact; occurrence: Occurrence }[] }[] = [
  {
    title: "Turn 7",
    meta: "now",
    entries: [{ artifact: ARTIFACTS[7]!, occurrence: ARTIFACTS[7]!.occurrences[1]! }],
  },
  {
    title: "Turn 6",
    meta: "14m ago",
    entries: [
      { artifact: ARTIFACTS[0]!, occurrence: ARTIFACTS[0]!.occurrences[0]! },
      { artifact: ARTIFACTS[1]!, occurrence: ARTIFACTS[1]!.occurrences[2]! },
      { artifact: ARTIFACTS[7]!, occurrence: ARTIFACTS[7]!.occurrences[0]! },
      { artifact: ARTIFACTS[1]!, occurrence: ARTIFACTS[1]!.occurrences[3]! },
    ],
  },
  {
    title: "Turn 5",
    meta: "40m ago",
    entries: [
      { artifact: ARTIFACTS[1]!, occurrence: ARTIFACTS[1]!.occurrences[1]! },
      { artifact: ARTIFACTS[6]!, occurrence: ARTIFACTS[6]!.occurrences[1]! },
    ],
  },
  {
    title: "Turn 4",
    meta: "1h ago",
    entries: [{ artifact: ARTIFACTS[3]!, occurrence: ARTIFACTS[3]!.occurrences[0]! }],
  },
  {
    title: "Message 2 · you",
    meta: "2h ago",
    older: true,
    entries: [{ artifact: ARTIFACTS[5]!, occurrence: ARTIFACTS[5]!.occurrences[0]! }],
  },
];

function OptionCContent({ state = "default", compact = false }: { state?: PanelState; compact?: boolean }) {
  const { query, type } = useStateData(state);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
      <SearchAndFilters query={query} type={type} compact={compact} />
      <div className="flex items-center gap-1 px-3 pt-2 text-xs">
        <span className="text-muted-foreground">View</span>
        <span className="rounded-md bg-state-active px-2 py-0.5 text-foreground">By time</span>
        <span className="rounded-md px-2 py-0.5 text-muted-foreground">By file</span>
      </div>
      <StateBody state={state} query={query}>
        {FEED.map((group) => ({
          ...group,
          entries: state === "filtered" ? group.entries.filter((e) => e.artifact.name === "README.md") : group.entries,
        })).filter((group) => group.entries.length > 0).map((group) => (
          <section key={group.title} aria-label={group.title}>
            <div className={cn("flex items-center gap-2 px-3 pb-1 pt-3", CHROME_SECTION_LABEL_CLASS)}>
              <span>{group.title}</span>
              <span className="text-subtle-foreground">{group.meta}</span>
              <button type="button" className="ml-auto flex items-center gap-1 normal-case text-muted-foreground">
                Jump <Icon name="CornerDownRight" className="size-3" />
              </button>
            </div>
            <ul>
              {group.entries.map(({ artifact, occurrence }) => (
                <li key={occurrence.id} className="px-1">
                  <button type="button" className={cn(LAUNCHER_ROW_BASE_CLASS, "hover:bg-state-hover")}>
                    <StatusIcon status={occurrence.status} />
                    <span className={cn("min-w-0 truncate text-sm", artifact.availability === "missing" ? "text-muted-foreground line-through" : "text-foreground")}>
                      {artifact.name}
                    </span>
                    <span className={cn("min-w-0 truncate text-xs", occurrence.status === "failed" ? "text-destructive-text" : "text-muted-foreground")}>
                      {occurrence.verb}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <OwnerTag owner={artifact.owner} />
                      {artifact.occurrences.length > 1 ? (
                        <span className="text-[11px] text-subtle-foreground">+{artifact.occurrences.length - 1}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="px-3 pt-2">
          <CoverageBannerInline />
        </div>
      </StateBody>
    </div>
  );
}

function CoverageBannerInline() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
      <Icon name="Clock" className="size-3.5" aria-hidden />
      <span className="flex-1">8 earlier turns not checked yet</span>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs">
        Check earlier
      </Button>
    </div>
  );
}

/* ---------------- shared states ---------------- */

type PanelState = "default" | "filtered" | "empty" | "no-results" | "loading";

function useStateData(state: PanelState) {
  return useMemo(() => {
    switch (state) {
      case "filtered":
        return { query: "readme", type: "doc" as const, items: ARTIFACTS.filter((a) => a.name.toLowerCase().includes("readme")) };
      case "no-results":
        return { query: "invoice", type: "all" as const, items: [] };
      case "empty":
        return { query: "", type: "all" as const, items: [] };
      case "loading":
        return { query: "", type: "all" as const, items: ARTIFACTS.slice(0, 3) };
      default:
        return { query: "", type: "all" as const, items: ARTIFACTS };
    }
  }, [state]);
}

function StateBody({ state, query, children }: { state: PanelState; query: string; children: ReactNode }) {
  if (state === "empty") {
    return (
      <EmptyStatePanel className="mx-3 mt-3">
        <div className="text-foreground">No files yet</div>
        <div className="mt-1 text-xs">
          Files the agent creates, edits, reads, or links, and files you attach, show up here.
        </div>
        <div className="mt-2 text-[11px] text-subtle-foreground">Checked all 3 turns in this thread.</div>
      </EmptyStatePanel>
    );
  }
  if (state === "no-results") {
    return (
      <EmptyStatePanel className="mx-3 mt-3">
        No files match “{query}”.
        <div className="mt-1 text-xs">Only checked turns are searched. 8 earlier turns not checked.</div>
      </EmptyStatePanel>
    );
  }
  return <>{children}</>;
}

/* ---------------- panel chrome harness ---------------- */

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

function DesktopStage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex h-[820px] w-[440px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
        <PanelGroup direction="horizontal">
          <PanelShell>{children}</PanelShell>
        </PanelGroup>
      </div>
    </div>
  );
}

function MobileStage({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <PanelGroup direction="horizontal">
        <PanelShell drawer>{children}</PanelShell>
      </PanelGroup>
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

function DesktopRow({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen gap-4 bg-background p-4">{children}</div>
    </Providers>
  );
}

export function OptionADesktop() {
  return (
    <DesktopRow>
      <DesktopStage label="A · default (partial history, expanded rows)"><OptionAContent /></DesktopStage>
      <DesktopStage label="A · search “readme” + Docs filter (same basename, different owner)"><OptionAContent state="filtered" /></DesktopStage>
      <div className="flex flex-col gap-4">
        <SmallStage label="A · no artifacts"><OptionAContent state="empty" /></SmallStage>
        <SmallStage label="A · no search results"><OptionAContent state="no-results" /></SmallStage>
      </div>
    </DesktopRow>
  );
}

function SmallStage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex h-[390px] w-[440px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
        <PanelGroup direction="horizontal">
          <PanelShell>{children}</PanelShell>
        </PanelGroup>
      </div>
    </div>
  );
}

export function OptionAMobile() {
  return (
    <Providers>
      <MobileStage><OptionAContent compact /></MobileStage>
    </Providers>
  );
}

export function OptionBDesktop() {
  return (
    <DesktopRow>
      <DesktopStage label="B · list + detail (selected: repeated file with failed edit)"><OptionBContent /></DesktopStage>
      <DesktopStage label="B · search “readme” + Docs filter"><OptionBContent state="filtered" layout="list" /></DesktopStage>
      <div className="flex flex-col gap-4">
        <SmallStage label="B · loading earlier turns"><OptionBContent state="loading" layout="list" /></SmallStage>
        <SmallStage label="B · no search results"><OptionBContent state="no-results" layout="list" /></SmallStage>
      </div>
    </DesktopRow>
  );
}

export function OptionBMobileList() {
  return (
    <Providers>
      <MobileStage><OptionBContent layout="list" /></MobileStage>
    </Providers>
  );
}

export function OptionBMobileDetail() {
  return (
    <Providers>
      <MobileStage><OptionBContent layout="detail" /></MobileStage>
    </Providers>
  );
}

export function OptionCDesktop() {
  return (
    <DesktopRow>
      <DesktopStage label="C · by time (grouped by source turn/message)"><OptionCContent /></DesktopStage>
      <DesktopStage label="C · search “readme” + Docs filter"><OptionCContent state="filtered" /></DesktopStage>
      <div className="flex flex-col gap-4">
        <SmallStage label="C · no artifacts"><OptionCContent state="empty" /></SmallStage>
        <SmallStage label="C · no search results"><OptionCContent state="no-results" /></SmallStage>
      </div>
    </DesktopRow>
  );
}

export function OptionCMobile() {
  return (
    <Providers>
      <MobileStage><OptionCContent compact /></MobileStage>
    </Providers>
  );
}
