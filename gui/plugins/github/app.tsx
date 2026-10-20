import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  definePluginApp,
  experimental_Diff as Diff,
  experimental_Icon as Icon,
  experimental_FileLink as FileLink,
  UrlLink,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
  type PluginRpcResult,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import {
  buildSuggestions,
  classifyGhFailure,
  matchesQuery,
  summarizeChecks,
  parseQuery,
  parseSubPath,
  routeToSubPath,
  type Item,
  type Route,
  type Suggestion,
  type SuggestionIcon,
} from "./app-logic.js";
import type { githubRpcContract } from "./server.js";
import { toast } from "sonner";
import { Badge, badgeVariants } from "@cloudroom/shared-ui/badge";
import { Button } from "@cloudroom/shared-ui/button";
import { DelayedLoading } from "@cloudroom/shared-ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@cloudroom/shared-ui/dropdown-menu";
import { Input } from "@cloudroom/shared-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cloudroom/shared-ui/select";
import { Skeleton } from "@cloudroom/shared-ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@cloudroom/shared-ui/tabs";
import { Textarea } from "@cloudroom/shared-ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown-lite";

type IssueDetail = PluginRpcResult<
  (typeof githubRpcContract)["getIssue"]
>["issue"];
type PullDetail = PluginRpcResult<
  (typeof githubRpcContract)["getPull"]
>["pull"];
type PullCheck = NonNullable<PullDetail["checks"]>[number];
type ReviewThread = PullDetail["reviewThreads"][number];
type PullFile = PullDetail["files"][number];
type Status = PluginRpcResult<(typeof githubRpcContract)["status"]>;
type RepoInfo = Status["repos"][number];
type LinksMap = PluginRpcResult<
  (typeof githubRpcContract)["listLinks"]
>["links"];
type ThreadLink = LinksMap[string][number];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const PANEL_PATH = "github";

function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
}

function useSubPathRoute(subPath: string): [Route, (route: Route) => void] {
  const bbNavigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigate = useCallback(
    (next: Route) => {
      bbNavigate.toPluginPanel(PANEL_PATH, { subPath: routeToSubPath(next) });
    },
    [bbNavigate],
  );
  return [route, navigate];
}

function useItems(kind: "issue" | "pr"): {
  items: Item[] | null;
  error: string | null;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const [state, setState] = useState<{
    items: Item[] | null;
    error: string | null;
  }>({
    items: null,
    error: null,
  });
  const refetch = useCallback(() => {
    rpc.call("listItems", { kind }).then(
      (result) => setState({ items: result.items, error: null }),
      (error: unknown) => setState({ items: null, error: errorText(error) }),
    );
  }, [rpc, kind]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return state;
}

function useLinks(): LinksMap {
  const rpc = useRpc<typeof githubRpcContract>();
  const [links, setLinks] = useState<LinksMap>({});
  const refetch = useCallback(() => {
    rpc.call("listLinks").then(
      (result) => setLinks(result.links),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("links-changed", refetch);
  return links;
}

function useSpawn(): {
  spawn: (
    method: "startWork" | "startReview",
    repo: string,
    number: number,
  ) => void;
  spawningKey: string | null;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const [spawningKey, setSpawningKey] = useState<string | null>(null);
  const spawn = useCallback(
    (method: "startWork" | "startReview", repo: string, number: number) => {
      setSpawningKey(`${repo}#${number}`);
      rpc
        .call(method, { repo, number })
        .then((result) => {
          navigate.toThread(result.threadId);
        })
        .catch((error: unknown) => toast.error(errorText(error)))
        .finally(() => setSpawningKey(null));
    },
    [rpc, navigate],
  );
  return { spawn, spawningKey };
}

let viewerLogin: string | null = null;

function useViewer(): string | null {
  const rpc = useRpc<typeof githubRpcContract>();
  const [login, setLogin] = useState<string | null>(viewerLogin);
  useEffect(() => {
    if (viewerLogin !== null) return;
    rpc.call("viewer").then(
      (result) => {
        viewerLogin = result.login;
        setLogin(result.login);
      },
      () => {},
    );
  }, [rpc]);
  return login;
}

function Avatar({
  login,
  size = "size-5",
  className,
}: {
  login: string;
  size?: string;
  className?: string;
}) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
      alt={login}
      title={login}
      loading="lazy"
      className={`${size} shrink-0 rounded-full bg-muted ${className ?? ""}`}
    />
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-50"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-15.2-6.5L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.2 6.5L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function stateDotClass(kind: "issue" | "pr", state: string): string {
  if (state === "OPEN") return "bg-green-500";
  if (kind === "pr" && state === "MERGED") return "bg-purple-500";
  if (kind === "pr") return "bg-red-500";
  return "bg-purple-500";
}

function StateDot({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${stateDotClass(kind, state)}`}
    />
  );
}

function StateBadge({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <StateDot kind={kind} state={state} />
      {state.toLowerCase()}
    </Badge>
  );
}

function ThreadPills({ links }: { links: ThreadLink[] | undefined }) {
  const navigate = useBbNavigate();
  if (links === undefined || links.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {links.map((link, index) => (
        <button
          type="button"
          key={link.threadId}
          title={`Open Cloudroom thread ${link.threadId}`}
          aria-label={`Open agent thread${links.length > 1 ? ` ${index + 1}` : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            navigate.toThread(link.threadId);
          }}
          className={`${badgeVariants({ variant: "secondary" })} cursor-pointer whitespace-nowrap hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:min-h-11`}
        >
          ⚡ agent{links.length > 1 ? ` ${index + 1}` : ""}
        </button>
      ))}
    </span>
  );
}

function LabelChips({
  labels,
  className,
}: {
  labels: string[];
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <span className={`items-center gap-1 ${className ?? "flex shrink-0"}`}>
      {labels.slice(0, 3).map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
    </span>
  );
}

function useIssueMutations() {
  const rpc = useRpc<typeof githubRpcContract>();
  const setIssueState = useCallback(
    (repo: string, number: number, state: "open" | "closed") =>
      rpc
        .call("setIssueState", { repo, number, state })
        .then(() =>
          toast.success(
            state === "closed" ? `#${number} closed` : `#${number} reopened`,
          ),
        ),
    [rpc],
  );
  const setAssignees = useCallback(
    (repo: string, number: number, assignees: string[]) =>
      rpc.call("setAssignees", { repo, number, assignees }),
    [rpc],
  );
  const setLabels = useCallback(
    (repo: string, number: number, labels: string[]) =>
      rpc.call("setLabels", { repo, number, labels }),
    [rpc],
  );
  return { setIssueState, setAssignees, setLabels };
}

function FilterSuggestionIcon({ icon }: { icon: SuggestionIcon }) {
  if (icon.kind === "state") {
    return <StateDot kind={icon.itemKind} state={icon.state} />;
  }
  return <Avatar login={icon.login} size="size-4" />;
}

function FilterBar({
  value,
  onChange,
  items,
  repos,
  kind,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Item[] | null;
  repos: RepoInfo[];
  kind: "issue" | "pr";
}) {
  const viewer = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);

  const vocab = useMemo(() => {
    const users = new Set<string>();
    const labels = new Set<string>();
    for (const item of items ?? []) {
      if (item.author.length > 0) users.add(item.author);
      for (const login of item.assignees) users.add(login);
      for (const label of item.labels) labels.add(label);
    }
    return {
      users: [...users].sort((a, b) => a.localeCompare(b)),
      labels: [...labels].sort((a, b) => a.localeCompare(b)),
      repos: repos.map((entry) => entry.repo),
    };
  }, [items, repos]);

  const upToCaret = value.slice(0, caret);
  const tokenStart = upToCaret.lastIndexOf(" ") + 1;
  const token = upToCaret.slice(tokenStart);
  const suggestions = useMemo(
    () => buildSuggestions(token, vocab, kind, viewer).slice(0, 8),
    [token, vocab, kind, viewer],
  );
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1));

  const syncCaret = () =>
    setCaret(inputRef.current?.selectionStart ?? value.length);

  const accept = (suggestion: Suggestion) => {
    const next =
      value.slice(0, tokenStart) + suggestion.insert + value.slice(caret);
    onChange(next);
    const position = tokenStart + suggestion.insert.length;
    setCaret(position);
    setHighlight(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(suggestions[active]);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Filter — is:open assignee:@me label:bug, or plain text"
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        spellCheck={false}
        autoComplete="off"
      />
      {value.length > 0 ? (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => {
            event.preventDefault();
            onChange("");
            setCaret(0);
            inputRef.current?.focus();
          }}
          aria-label="Clear filter"
        >
          ✕
        </button>
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.insert}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                index === active
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {suggestion.icon !== undefined ? (
                <FilterSuggestionIcon icon={suggestion.icon} />
              ) : null}
              <span className="min-w-0 truncate font-medium">
                {suggestion.label}
              </span>
              {suggestion.hint !== undefined ? (
                <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">
                  {suggestion.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const COL = {
  id: "shrink-0 @[48rem]:w-12",
  assignee: "shrink-0 @[48rem]:w-20",
  status: "shrink-0 @[48rem]:w-24",
  updated: "hidden w-14 shrink-0 text-right @[48rem]:block",
  actions:
    "ml-auto flex shrink-0 items-center justify-end gap-1 @[48rem]:ml-0 @[48rem]:w-24",
} as const;

function AssigneeCell({ assignees }: { assignees: string[] }) {
  if (assignees.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <span
      className="flex items-center -space-x-1.5"
      title={assignees.join(", ")}
    >
      {assignees.slice(0, 3).map((login) => (
        <Avatar key={login} login={login} className="ring-1 ring-card" />
      ))}
      {assignees.length > 3 ? (
        <span className="pl-2.5 text-xs text-muted-foreground">
          +{assignees.length - 3}
        </span>
      ) : null}
    </span>
  );
}

function StatusCell({ item }: { item: Item }) {
  const { setIssueState } = useIssueMutations();
  const [pending, setPending] = useState(false);
  if (item.kind === "pr") {
    return <StateBadge kind="pr" state={item.state} />;
  }
  const change = (next: "open" | "closed") => {
    if ((item.state === "OPEN") === (next === "open")) return;
    setPending(true);
    setIssueState(item.repo, item.number, next)
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPending(false));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs font-normal"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Change issue #${item.number} state, currently ${item.state.toLowerCase()}`}
          aria-busy={pending}
        >
          <StateDot kind="issue" state={item.state} />
          <span>{pending ? "…" : item.state.toLowerCase()}</span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => change("open")}>
          <StateDot kind="issue" state="OPEN" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => change("closed")}>
          <StateDot kind="issue" state="CLOSED" />
          Closed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({ item }: { item: Item }) {
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const { setIssueState, setAssignees } = useIssueMutations();
  const assignedToMe = viewer !== null && item.assignees.includes(viewer);

  const toggleSelfAssign = () => {
    if (viewer === null) return;
    const next = assignedToMe
      ? item.assignees.filter((login) => login !== viewer)
      : [...item.assignees, viewer];
    setAssignees(item.repo, item.number, next)
      .then(() =>
        toast.success(
          assignedToMe
            ? `Unassigned from #${item.number}`
            : `Assigned to #${item.number}`,
        ),
      )
      .catch((error: unknown) => toast.error(errorText(error)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          ⋮
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.kind === "issue" && viewer !== null ? (
          <DropdownMenuItem onSelect={toggleSelfAssign}>
            {assignedToMe ? "Unassign me" : "Assign to me"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? (
          <DropdownMenuItem
            onSelect={() =>
              setIssueState(
                item.repo,
                item.number,
                item.state === "OPEN" ? "closed" : "open",
              ).catch((error: unknown) => toast.error(errorText(error)))
            }
          >
            {item.state === "OPEN" ? "Close issue" : "Reopen issue"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          onSelect={() => {
            navigate.openUrl(item.url);
          }}
        >
          Open on GitHub ↗
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(item.url).then(
              () => toast.success("Link copied"),
              () => toast.error("Could not copy the link"),
            );
          }}
        >
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemRow({
  item,
  links,
  onOpen,
}: {
  item: Item;
  links: ThreadLink[] | undefined;
  onOpen: () => void;
}) {
  const { spawn, spawningKey } = useSpawn();
  const busy = spawningKey === `${item.repo}#${item.number}`;
  return (
    <div
      className="grid cursor-pointer grid-cols-1 gap-y-2 px-3 py-3 hover:bg-accent/50 @[48rem]:flex @[48rem]:items-center @[48rem]:gap-3 @[48rem]:py-2"
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-col items-start gap-1.5 @[48rem]:order-2 @[48rem]:flex-1 @[48rem]:flex-row @[48rem]:items-center @[48rem]:gap-2">
        <span className="min-w-0 flex-1 line-clamp-3 text-sm font-medium leading-snug text-foreground @[48rem]:line-clamp-1 @[48rem]:leading-normal">
          {item.title}
        </span>
        <LabelChips
          labels={item.labels}
          className="hidden shrink-0 @[60rem]:flex"
        />
        <ThreadPills links={links} />
      </span>
      <span className="flex min-w-0 items-center gap-2 @[48rem]:contents">
        <span
          className={`${COL.id} font-mono text-xs text-muted-foreground @[48rem]:order-1`}
        >
          #{item.number}
        </span>
        <span
          className={`${COL.assignee} ${item.assignees.length === 0 ? "hidden @[48rem]:flex" : "flex"} text-xs text-muted-foreground @[48rem]:order-3`}
        >
          <AssigneeCell assignees={item.assignees} />
        </span>
        <span className={`${COL.status} @[48rem]:order-4`}>
          <StatusCell item={item} />
        </span>
        <span
          className={`${COL.updated} text-xs text-muted-foreground @[48rem]:order-5`}
        >
          {relativeTime(item.updatedAt)}
        </span>
        <span className={`${COL.actions} @[48rem]:order-6`}>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={spawningKey !== null}
            onClick={(event) => {
              event.stopPropagation();
              spawn(
                item.kind === "issue" ? "startWork" : "startReview",
                item.repo,
                item.number,
              );
            }}
          >
            {busy ? "…" : item.kind === "issue" ? "Start" : "Review"}
          </Button>
          <RowMenu item={item} />
        </span>
      </span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <DelayedLoading>
      <div className="divide-y divide-border">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="grid grid-cols-1 gap-y-3 px-3 py-3 @[48rem]:flex @[48rem]:items-center @[48rem]:gap-3"
          >
            <Skeleton className="h-3 w-4/5 @[48rem]:order-2 @[48rem]:flex-1" />
            <span className="flex items-center gap-2 @[48rem]:contents">
              <span className={`${COL.id} @[48rem]:order-1`}>
                <Skeleton className="h-3 w-10" />
              </span>
              <span className={`${COL.assignee} flex @[48rem]:order-3`}>
                <Skeleton className="size-5 rounded-full @[48rem]:h-3 @[48rem]:w-16" />
              </span>
              <span className={`${COL.status} @[48rem]:order-4`}>
                <Skeleton className="h-3 w-16" />
              </span>
              <span className={`${COL.updated} @[48rem]:order-5`}>
                <Skeleton className="ml-auto h-3 w-12" />
              </span>
              <span className={`${COL.actions} @[48rem]:order-6`}>
                <Skeleton className="h-7 w-20" />
              </span>
            </span>
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

function DetailSkeleton() {
  return (
    <DelayedLoading>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    </DelayedLoading>
  );
}

function ItemsTable({
  kind,
  items,
  error,
  hasFilter,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  items: Item[] | null;
  error: string | null;
  hasFilter: boolean;
  onOpenItem: (repo: string, number: number) => void;
}) {
  const links = useLinks();

  let body: React.ReactNode;
  if (error !== null) {
    body = <EmptyState message={error} />;
  } else if (items === null) {
    body = <TableSkeleton />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        message={
          hasFilter
            ? `No ${kind === "issue" ? "issues" : "pull requests"} match this filter.`
            : `No ${kind === "issue" ? "issues" : "pull requests"} in the tracked repos.`
        }
      />
    );
  } else {
    body = (
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ItemRow
            key={`${item.repo}#${item.number}`}
            item={item}
            links={links[`${kind}:${item.repo}#${item.number}`]}
            onOpen={() => onOpenItem(item.repo, item.number)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground @[48rem]:flex">
        <span className={COL.id}>ID</span>
        <span className="min-w-0 flex-1">Title</span>
        <span className={COL.assignee}>Assignee</span>
        <span className={COL.status}>Status</span>
        <span className={COL.updated}>Updated</span>
        <span className={COL.actions} />
      </div>
      {body}
    </div>
  );
}

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function AssigneePicker({
  repo,
  assignees,
  onToggle,
}: {
  repo: string;
  assignees: string[];
  onToggle: (login: string, assigned: boolean) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const viewer = useViewer();
  const [users, setUsers] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (users !== null) return;
    rpc.call("assignableUsers", { repo }).then(
      (result) => setUsers(result.users),
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, users]);

  const ordered =
    users === null
      ? null
      : [...users].sort((a, b) => Number(b === viewer) - Number(a === viewer));

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Assignees</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No assignable users</DropdownMenuItem>
        ) : (
          ordered.map((login) => (
            <DropdownMenuCheckboxItem
              key={login}
              checked={assignees.includes(login)}
              onCheckedChange={(checked) => onToggle(login, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar login={login} size="size-4" />
                <span className="truncate">
                  {login}
                  {login === viewer ? " (you)" : ""}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelPicker({
  repo,
  labels,
  onToggle,
}: {
  repo: string;
  labels: string[];
  onToggle: (label: string, enabled: boolean) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (available !== null) return;
    rpc.call("repositoryLabels", { repo }).then(
      (result) => setAvailable(result.labels),
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, available]);

  const ordered =
    available === null
      ? null
      : [...new Set([...labels, ...available])].sort((a, b) =>
          a.localeCompare(b),
        );

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Labels</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No labels in repo</DropdownMenuItem>
        ) : (
          ordered.map((label) => (
            <DropdownMenuCheckboxItem
              key={label}
              checked={labels.includes(label)}
              onCheckedChange={(checked) => onToggle(label, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IssueDetailView({
  repo,
  number,
  onBack,
}: {
  repo: string;
  number: number;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const links = useLinks();
  const { spawn, spawningKey } = useSpawn();
  const { setIssueState, setAssignees, setLabels } = useIssueMutations();
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    rpc.call("getIssue", { repo, number }).then(
      (result) => {
        setDetail(result.issue);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  const changeState = useCallback(
    (next: "open" | "closed") => {
      setDetail((prev) =>
        prev === null
          ? prev
          : { ...prev, state: next === "closed" ? "CLOSED" : "OPEN" },
      );
      setIssueState(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setIssueState, repo, number, load],
  );

  const toggleAssignee = useCallback(
    (login: string, assigned: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = assigned
          ? [...new Set([...prev.assignees, login])]
          : prev.assignees.filter((entry) => entry !== login);
        return { ...prev, assignees: next };
      });
      setAssignees(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setAssignees, repo, number, load],
  );

  const toggleLabel = useCallback(
    (label: string, enabled: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = enabled
          ? [...new Set([...prev.labels, label])]
          : prev.labels.filter((entry) => entry !== label);
        return { ...prev, labels: next };
      });
      setLabels(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setLabels, repo, number, load],
  );

  const postComment = useCallback(() => {
    if (comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentIssue", { repo, number, body: comment })
      .then(() => {
        setComment("");
        load();
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setPosting(false));
  }, [rpc, repo, number, comment, load]);

  if (error !== null) return <EmptyState message={error} />;
  if (detail === null) {
    return <DetailSkeleton />;
  }

  const issueLinks = links[`issue:${repo}#${number}`];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onBack}>
          ← Issues
        </Button>
        <span>
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <UrlLink href={detail.url} className="underline hover:text-foreground">
          Open on GitHub ↗
        </UrlLink>
      </div>

      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-xl font-semibold text-foreground">
          {detail.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{detail.number}
          </span>
        </h2>
        <Button
          size="sm"
          disabled={spawningKey !== null}
          onClick={() => spawn("startWork", repo, number)}
        >
          {spawningKey !== null ? "Starting…" : "Send agent"}
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              <Avatar login={detail.author} />
              <span className="font-medium text-foreground">
                {detail.author}
              </span>
              opened this issue · updated {relativeTime(detail.updatedAt)}
            </div>
            <div className="p-4">
              {detail.body.length > 0 ? (
                <Markdown content={detail.body} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  (no description)
                </p>
              )}
            </div>
          </div>

          {detail.comments.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Activity · {detail.comments.length}
              </h3>
              {detail.comments.map((entry, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar login={entry.author} />
                    <span className="font-medium text-foreground">
                      {entry.author}
                    </span>{" "}
                    · {relativeTime(entry.createdAt)}
                  </p>
                  <Markdown content={entry.body} className="text-sm" />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Leave a comment…"
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={posting || comment.trim().length === 0}
                onClick={postComment}
              >
                {posting ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
          <div className="flex flex-col gap-2">
            <SidebarHeading>Status</SidebarHeading>
            <Select
              value={detail.state === "OPEN" ? "open" : "closed"}
              onValueChange={(value) =>
                changeState(value === "closed" ? "closed" : "open")
              }
            >
              <SelectTrigger className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="OPEN" /> Open
                  </span>
                </SelectItem>
                <SelectItem value="closed">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="CLOSED" /> Closed
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <SidebarHeading>Assignees</SidebarHeading>
              <AssigneePicker
                repo={repo}
                assignees={detail.assignees}
                onToggle={toggleAssignee}
              />
            </div>
            {detail.assignees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one assigned</p>
            ) : (
              detail.assignees.map((login) => (
                <p
                  key={login}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Avatar login={login} />
                  <span className="truncate">{login}</span>
                </p>
              ))
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SidebarHeading>Labels</SidebarHeading>
              <LabelPicker
                repo={repo}
                labels={detail.labels}
                onToggle={toggleLabel}
              />
            </div>
            {detail.labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet</p>
            ) : (
              <LabelChips labels={detail.labels} className="flex flex-wrap" />
            )}
          </div>

          {issueLinks !== undefined && issueLinks.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Agents</SidebarHeading>
              <ThreadPills links={issueLinks} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const PULL_STATE_DISPLAY: Record<
  string,
  { icon: string; className: string; label: string }
> = {
  OPEN: {
    icon: "GitPullRequestArrow",
    className: "text-success",
    label: "Open",
  },
  DRAFT: {
    icon: "GitPullRequestDraft",
    className: "text-muted-foreground",
    label: "Draft",
  },
  MERGED: { icon: "GitMerge", className: "text-pr-merged", label: "Merged" },
  CLOSED: {
    icon: "GitPullRequestClosed",
    className: "text-destructive",
    label: "Closed",
  },
};

function pullStateDisplay(state: string) {
  return (
    PULL_STATE_DISPLAY[state] ?? {
      icon: "CircleQuestion",
      className: "text-muted-foreground",
      label: "State unknown",
    }
  );
}

function Notice({
  tone,
  urgent = false,
  children,
}: {
  tone: "info" | "warn" | "error";
  urgent?: boolean;
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-border bg-muted/60",
    warn: "border-warning/50 bg-warning/10",
    error: "border-destructive/50 bg-destructive/10",
  }[tone];
  return (
    <div
      role={urgent ? "alert" : undefined}
      className={`rounded-md border px-3 py-2 text-xs leading-relaxed text-foreground ${cls}`}
    >
      {children}
    </div>
  );
}

function PullStateBadge({ state }: { state: string }) {
  const { icon, className, label } = pullStateDisplay(state);
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <Icon
        name={icon}
        className={`size-3.5 shrink-0 ${className}`}
        aria-hidden
      />
      {label}
    </Badge>
  );
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "review requested",
};

function reviewStateClass(state: string): string {
  if (state === "APPROVED") return "text-green-600 dark:text-green-400";
  if (state === "CHANGES_REQUESTED") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function ReviewDecisionBadge({ decision }: { decision: string }) {
  if (decision === "APPROVED") {
    return (
      <Badge className="bg-green-600 text-white hover:bg-green-600">
        approved
      </Badge>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return <Badge variant="destructive">changes requested</Badge>;
  }
  if (decision === "REVIEW_REQUIRED") {
    return <Badge variant="secondary">review required</Badge>;
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {decision === "" ? "no review decision" : decision.toLowerCase()}
    </Badge>
  );
}

const CHECK_STATUS_DISPLAY: Record<
  PullCheck["status"],
  { icon: string; className: string; label: string }
> = {
  success: { icon: "CircleCheck", className: "text-success", label: "passed" },
  failure: { icon: "CircleX", className: "text-destructive", label: "failed" },
  pending: { icon: "Clock", className: "text-warning", label: "pending" },
  neutral: {
    icon: "Unavailable",
    className: "text-muted-foreground",
    label: "neutral or skipped",
  },
  unknown: {
    icon: "CircleQuestion",
    className: "text-muted-foreground",
    label: "result unknown",
  },
};

function checksSummaryParts(checks: PullCheck[] | null): {
  icon: string;
  className: string;
  text: string;
} {
  const summary = summarizeChecks(checks);
  if (summary.state === "unknown") {
    return {
      icon: "CircleQuestion",
      className: "text-muted-foreground",
      text: "Checks unknown",
    };
  }
  if (summary.state === "none") {
    return {
      icon: "Circle",
      className: "text-muted-foreground",
      text: "No checks reported",
    };
  }
  const parts = [
    summary.failed > 0 ? `${summary.failed} failing` : null,
    summary.pending > 0 ? `${summary.pending} pending` : null,
    summary.unknown > 0 ? `${summary.unknown} unknown` : null,
    `${summary.passed}/${summary.total} passed`,
    summary.neutral > 0 ? `${summary.neutral} skipped or neutral` : null,
  ].filter((part) => part !== null);
  const display = {
    failing: CHECK_STATUS_DISPLAY.failure,
    pending: CHECK_STATUS_DISPLAY.pending,
    unknown_results: CHECK_STATUS_DISPLAY.unknown,
    passing:
      summary.neutral > 0
        ? CHECK_STATUS_DISPLAY.neutral
        : CHECK_STATUS_DISPLAY.success,
    neutral: CHECK_STATUS_DISPLAY.neutral,
  }[summary.state];
  const prefix =
    summary.state === "passing" && summary.neutral === 0
      ? "Checks passing"
      : summary.state === "neutral"
        ? "Checks skipped or neutral"
        : "Checks";
  return {
    icon: display.icon,
    className: display.className,
    text: `${prefix} · ${parts.join(" · ")}`,
  };
}

function ChecksSection({
  checks,
  staleSince = null,
}: {
  checks: PullCheck[] | null;
  staleSince?: string | null;
}) {
  const [open, setOpen] = useState(
    () => checks?.some((check) => check.status === "failure") ?? false,
  );
  const listId = useId();
  const summary = checksSummaryParts(checks);
  const { icon, className } = summary;
  const text =
    staleSince === null
      ? summary.text
      : `${summary.text} · as of ${staleSince}`;
  const summaryIcon = (
    <Icon name={icon} className={`size-4 shrink-0 ${className}`} aria-hidden />
  );
  if (checks === null || checks.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        {summaryIcon}
        <span className="text-foreground">{text}</span>
        {checks === null ? (
          <span className="text-xs text-muted-foreground">
            GitHub did not report check status
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 pointer-coarse:min-h-11"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        {summaryIcon}
        <span className="min-w-0 flex-1 text-foreground">{text}</span>
        <span aria-hidden className="text-xs text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          className="divide-y divide-border border-t border-border"
        >
          {checks.map((check, index) => {
            const display = CHECK_STATUS_DISPLAY[check.status];
            return (
              <li
                key={`${check.name}-${index}`}
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                <Icon
                  name={display.icon}
                  className={`size-3.5 shrink-0 ${display.className}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {check.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {display.label}
                </span>
                {check.url.length > 0 ? (
                  <UrlLink
                    href={check.url}
                    className="inline-flex shrink-0 items-center text-muted-foreground underline hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-2"
                    aria-label={`${check.name} details`}
                  >
                    details ↗
                  </UrlLink>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function FileDiffCard({
  environmentId,
  file,
  url,
}: {
  environmentId: string | null;
  file: PullFile;
  url: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent/50">
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          aria-label={`${open ? "Collapse" : "Expand"} ${file.path} diff`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "▾" : "▸"}
        </button>
        {environmentId === null || file.status === "removed" ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
            {file.path}
          </span>
        ) : (
          <FileLink
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground hover:underline"
            target={{
              kind: "workspace",
              environmentId,
              path: file.path,
            }}
          >
            {file.path}
          </FileLink>
        )}
        {file.status !== "modified" ? (
          <Badge
            variant="secondary"
            className="shrink-0 font-normal text-muted-foreground"
          >
            {file.status}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs text-green-600 dark:text-green-400">
          +{file.additions}
        </span>
        <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
          −{file.deletions}
        </span>
      </div>
      {open ? (
        file.patch !== null ? (
          <div className="border-t border-border">
            <Diff patch={file.patch} path={file.path} />
          </div>
        ) : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Diff too large to inline —{" "}
            <UrlLink href={`${url}/files`} className="underline">
              view on GitHub ↗
            </UrlLink>
          </p>
        )
      ) : null}
    </div>
  );
}

function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <p className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{thread.path}</span>
        {thread.line !== null ? (
          <span className="shrink-0">:{thread.line}</span>
        ) : null}
      </p>
      {thread.diffHunk.length > 0 ? (
        <div className="border-b border-border">
          <Diff patch={thread.diffHunk} path={thread.path} />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {thread.comments.map((entry, index) => (
          <div key={index}>
            <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Avatar login={entry.author} size="size-4" />
              <span className="font-medium text-foreground">
                {entry.author}
              </span>{" "}
              · {relativeTime(entry.createdAt)}
            </p>
            <Markdown content={entry.body} className="text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

type PullTimelineEntry =
  | { type: "comment"; author: string; body: string; createdAt: string }
  | {
      type: "review";
      author: string;
      state: string;
      body: string;
      createdAt: string;
    };

function PullTimeline({ pull }: { pull: PullDetail }) {
  const entries = useMemo<PullTimelineEntry[]>(() => {
    const merged: PullTimelineEntry[] = [
      ...pull.comments.map((comment) => ({
        type: "comment" as const,
        ...comment,
      })),
      ...pull.reviews
        .filter(
          (review) => review.body.length > 0 || review.state !== "COMMENTED",
        )
        .map((review) => ({ type: "review" as const, ...review })),
    ];
    return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [pull]);
  if (entries.length === 0 && pull.reviewThreads.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Activity · {entries.length + pull.reviewThreads.length}
      </h3>
      {entries.map((entry, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-card p-3"
        >
          <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar login={entry.author} />
            <span className="font-medium text-foreground">{entry.author}</span>
            {entry.type === "review" ? (
              <span className={`font-medium ${reviewStateClass(entry.state)}`}>
                {REVIEW_STATE_LABELS[entry.state] ?? entry.state.toLowerCase()}
              </span>
            ) : null}
            · {relativeTime(entry.createdAt)}
          </p>
          {entry.body.length > 0 ? (
            <Markdown content={entry.body} className="text-sm" />
          ) : null}
        </div>
      ))}
      {pull.reviewThreads.map((thread, index) => (
        <ReviewThreadCard key={index} thread={thread} />
      ))}
    </div>
  );
}

function PullReviewersList({ pull }: { pull: PullDetail }) {
  const rows = useMemo(() => {
    const latest = new Map<string, { login: string; state: string }>();
    for (const review of pull.reviews) {
      if (review.author.length > 0) {
        latest.set(review.author, {
          login: review.author,
          state: review.state,
        });
      }
    }
    for (const login of pull.reviewRequests) {
      latest.set(login, { login, state: "PENDING" });
    }
    return [...latest.values()];
  }, [pull]);
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No reviewers</p>;
  return (
    <>
      {rows.map((row) => (
        <p
          key={row.login}
          className="flex items-center gap-2 text-sm text-foreground"
        >
          <Avatar login={row.login} />
          <span className="min-w-0 truncate">{row.login}</span>
          <span
            className={`ml-auto shrink-0 text-xs ${reviewStateClass(row.state)}`}
          >
            {REVIEW_STATE_LABELS[row.state] ?? row.state.toLowerCase()}
          </span>
        </p>
      ))}
    </>
  );
}

function PullCommentBox({
  repo,
  number,
  onPosted,
}: {
  repo: string;
  number: number;
  onPosted: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const post = useCallback(() => {
    if (comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentPull", { repo, number, body: comment })
      .then(() => {
        setComment("");
        onPosted();
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPosting(false));
  }, [rpc, repo, number, comment, onPosted]);
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Leave a comment…"
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={posting || comment.trim().length === 0}
          onClick={post}
        >
          {posting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

interface PullDetailState {
  pull: PullDetail | null;
  fetchedAt: string | null;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

const PLUGIN_MACHINE =
  "the machine running the Cloudroom server (where the GitHub plugin runs)";

function describeGhError(message: string): string {
  const reason = classifyGhFailure(message);
  if (reason === "auth" && isPermissionFailure(message)) {
    return `GitHub access needed: gh is signed in on ${PLUGIN_MACHINE}, but that account can’t read this repository. Ask for access or authorize it for the organization’s single sign-on (for example gh auth refresh -h github.com), then try again. Details: ${message}`;
  }
  if (reason === "auth") {
    return `GitHub sign-in needed: gh isn’t signed in on ${PLUGIN_MACHINE}. Run gh auth login there, then try again. Details: ${message}`;
  }
  if (reason === "unavailable") {
    return `GitHub is unavailable right now. Details: ${message}`;
  }
  return message;
}

function usePullDetail(repo: string, number: number): PullDetailState {
  const rpc = useRpc<typeof githubRpcContract>();
  const key = `${repo}#${number}`;
  const initial = useMemo(
    () => ({
      key,
      pull: null as PullDetail | null,
      fetchedAt: null as string | null,
      refreshing: true,
      error: null as string | null,
    }),
    [key],
  );
  const [stored, setState] = useState(initial);
  const state = stored.key === key ? stored : initial;
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const current = ++generation.current;
    setState((prev) =>
      prev.key === key
        ? { ...prev, refreshing: true }
        : { ...initial, refreshing: true },
    );
    rpc.call("getPull", { repo, number }).then(
      (result) => {
        if (current !== generation.current || result.pull.number !== number) {
          return;
        }
        setState({
          key,
          pull: result.pull,
          fetchedAt: result.fetchedAt,
          refreshing: false,
          error: null,
        });
      },
      (error: unknown) => {
        if (current !== generation.current) return;
        setState((prev) => ({
          ...(prev.key === key ? prev : initial),
          refreshing: false,
          error: errorText(error),
        }));
      },
    );
  }, [rpc, repo, number, key, initial]);

  useEffect(() => {
    let cancelled = false;
    rpc.call("cachedPull", { repo, number }).then(
      (result) => {
        const cached = result.cached;
        if (cancelled || cached === null || cached.pull.number !== number) {
          return;
        }
        setState((prev) => {
          const base = prev.key === key ? prev : initial;
          return base.pull !== null
            ? base
            : { ...base, pull: cached.pull, fetchedAt: cached.fetchedAt };
        });
      },
      () => {},
    );
    refresh();
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [rpc, repo, number, key, initial, refresh]);

  return {
    pull: state.pull,
    fetchedAt: state.fetchedAt,
    refreshing: state.refreshing,
    error: state.error,
    refresh,
  };
}

function PullDetailView({
  repo,
  number,
  onBack,
}: {
  repo: string;
  number: number;
  onBack: () => void;
}) {
  const detail = usePullDetail(repo, number);
  if (detail.pull === null) {
    return detail.error !== null ? (
      <EmptyState message={describeGhError(detail.error)} />
    ) : (
      <DetailSkeleton />
    );
  }
  return (
    <PullDetailBody
      repo={repo}
      number={number}
      detail={detail}
      pull={detail.pull}
      onBack={onBack}
    />
  );
}

function PullDetailBody({
  repo,
  number,
  detail,
  pull,
  onBack,
  backLabel = "Pull requests",
  compact = false,
  readOnly = false,
  workspaceEnvironmentId = null,
}: {
  repo: string;
  number: number;
  detail: PullDetailState;
  pull: PullDetail;
  onBack?: () => void;
  backLabel?: string;
  compact?: boolean;
  readOnly?: boolean;
  workspaceEnvironmentId?: string | null;
}) {
  useMinuteTick();
  const links = useLinks();
  const { spawn, spawningKey } = useSpawn();
  const { error, fetchedAt } = detail;
  const staleSince =
    error !== null && fetchedAt !== null ? relativeTime(fetchedAt) : null;

  const pullLinks = links[`pr:${repo}#${number}`];
  const mainColumn = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <ChecksSection checks={pull.checks} staleSince={staleSince} />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <Avatar login={pull.author} />
          <span className="font-medium text-foreground">{pull.author}</span>
          opened this pull request · updated {relativeTime(pull.updatedAt)}
        </div>
        <div className="p-4">
          {pull.body.length > 0 ? (
            <Markdown content={pull.body} className="text-sm" />
          ) : (
            <p className="text-sm text-muted-foreground">(no description)</p>
          )}
        </div>
      </div>

      <PullTimeline pull={pull} />

      {pull.files.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Files changed · {pull.files.length}
            <span className="ml-2 font-normal">
              <span className="text-green-600 dark:text-green-400">
                +{pull.additions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                −{pull.deletions}
              </span>
            </span>
          </h3>
          {pull.files.map((file) => (
            <FileDiffCard
              key={file.path}
              environmentId={workspaceEnvironmentId}
              file={file}
              url={pull.url}
            />
          ))}
        </div>
      ) : null}

      {readOnly ? null : (
        <PullCommentBox repo={repo} number={number} onPosted={detail.refresh} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {pull.repo.toLowerCase() !== repo.toLowerCase() ? (
        <Notice tone="info">
          GitHub now reports this pull request as {pull.repo}#{pull.number}.
        </Notice>
      ) : null}
      {error !== null ? (
        <Notice tone="warn">
          Refresh failed. Showing data fetched{" "}
          {fetchedAt !== null ? relativeTime(fetchedAt) : "earlier"}.{" "}
          {describeGhError(error)}
        </Notice>
      ) : null}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {onBack !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onBack}
          >
            ← {backLabel}
          </Button>
        ) : null}
        <span className="min-w-0 break-all">
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <UrlLink
          href={pull.url}
          className="inline-flex shrink-0 items-center underline hover:text-foreground pointer-coarse:min-h-11"
        >
          Open on GitHub ↗
        </UrlLink>
      </div>

      <div className="flex items-start gap-3">
        <h2
          className={`min-w-0 flex-1 font-semibold text-foreground ${compact ? "text-base" : "text-xl"}`}
        >
          {pull.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{pull.number}
          </span>
        </h2>
        {readOnly ? null : (
          <Button
            size="sm"
            disabled={spawningKey !== null}
            onClick={() => spawn("startReview", repo, number)}
          >
            {spawningKey !== null ? "Starting…" : "Review with agent"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <PullStateBadge state={pull.state} />
        <ReviewDecisionBadge decision={pull.reviewDecision} />
        <span className="font-mono">
          {pull.baseRefName} ← {pull.headRefName}
        </span>
        <span>
          <span className="text-green-600 dark:text-green-400">
            +{pull.additions}
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">
            −{pull.deletions}
          </span>{" "}
          · {pull.changedFiles} file{pull.changedFiles === 1 ? "" : "s"}
        </span>
        <LabelChips labels={pull.labels} className="flex flex-wrap" />
        <ThreadPills links={pullLinks} />
      </div>

      {compact ? (
        mainColumn
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {mainColumn}
          <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
            <div className="flex flex-col gap-1">
              <SidebarHeading>Reviewers</SidebarHeading>
              <PullReviewersList pull={pull} />
            </div>
            <div className="flex flex-col gap-1">
              <SidebarHeading>Assignees</SidebarHeading>
              {pull.assignees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one assigned</p>
              ) : (
                pull.assignees.map((login) => (
                  <p
                    key={login}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <Avatar login={login} />
                    <span className="truncate">{login}</span>
                  </p>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Labels</SidebarHeading>
              {pull.labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet</p>
              ) : (
                <LabelChips labels={pull.labels} className="flex flex-wrap" />
              )}
            </div>
            {pullLinks !== undefined && pullLinks.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SidebarHeading>Agents</SidebarHeading>
                <ThreadPills links={pullLinks} />
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

type PullAssociation = PluginRpcResult<
  (typeof githubRpcContract)["pullForThread"]
>;
type PullRef = { repo: string; number: number };

function usePullAssociation(threadId: string) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [association, setAssociation] = useState<PullAssociation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const generation = useRef(0);
  const saveSequence = useRef(0);

  const accept = useCallback(
    (current: number, result: PullAssociation) => {
      if (current !== generation.current || result.threadId !== threadId) {
        return;
      }
      setAssociation(result);
      setError(null);
      setLoading(false);
    },
    [threadId],
  );

  const reload = useCallback(() => {
    const current = ++generation.current;
    setLoading(true);
    rpc.call("pullForThread", { threadId }).then(
      (result) => accept(current, result),
      (err: unknown) => {
        if (current !== generation.current) return;
        setError(errorText(err));
        setLoading(false);
      },
    );
  }, [rpc, threadId, accept]);

  const choose = useCallback(
    (pull: PullRef | null): Promise<boolean> => {
      const current = ++generation.current;
      const save = ++saveSequence.current;
      setSaving(true);
      setSaveError(null);
      return rpc
        .call("setPullForThread", { threadId, pull })
        .then(
          (result) => {
            accept(current, result);
            return save === saveSequence.current;
          },
          (err: unknown) => {
            if (save === saveSequence.current) {
              setSaveError(errorText(err));
            }
            setLoading(false);
            return false;
          },
        )
        .finally(() => {
          if (save === saveSequence.current) setSaving(false);
        });
    },
    [rpc, threadId, accept],
  );

  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);
  useRealtime("association-changed", (payload) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) {
      reload();
    }
  });

  return { association, error, loading, saving, saveError, reload, choose };
}

const SOURCE_LABELS: Record<"workspace" | "review", string> = {
  workspace: "workspace branch",
  review: "review thread",
};

function parsePullInput(value: string): PullRef | null {
  const trimmed = value.trim();
  const url = trimmed.match(
    /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/,
  );
  const short = trimmed.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  const match = url ?? short;
  if (match === null) return null;
  const number = Number(match[2]);
  return number > 0 ? { repo: match[1], number } : null;
}

function PullChooser({
  candidates,
  onChoose,
  disabled,
}: {
  candidates: PullAssociation["candidates"];
  onChoose: (pull: PullRef) => void;
  disabled: boolean;
}) {
  const { items, error } = useItems("pr");
  const [query, setQuery] = useState("");
  const inputId = useId();
  const direct = parsePullInput(query);
  const sourcesFor = (repo: string, number: number) =>
    candidates.find(
      (candidate) =>
        candidate.number === number &&
        candidate.repo.toLowerCase() === repo.toLowerCase(),
    )?.sources ?? [];
  const needle = query.trim().toLowerCase();
  const rows = (items ?? [])
    .filter(
      (item) =>
        needle.length === 0 ||
        `${item.repo}#${item.number} ${item.title}`
          .toLowerCase()
          .includes(needle.replace(/^#/, "")),
    )
    .sort(
      (a, b) =>
        sourcesFor(b.repo, b.number).length -
          sourcesFor(a.repo, a.number).length ||
        Number(b.state === "OPEN") - Number(a.state === "OPEN"),
    )
    .slice(0, 30);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        Search tracked PRs, or paste a PR link or owner/repo#number
      </label>
      <Input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="acme/widgets#42"
        className="h-8 min-w-0 pointer-coarse:h-11"
      />
      {direct !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
            {direct.repo}#{direct.number}
          </span>
          <Button
            size="sm"
            className="h-8 pointer-coarse:h-11"
            disabled={disabled}
            onClick={() => onChoose(direct)}
          >
            Use this pull request
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : null}
      {rows.length > 0 ? (
        <div
          role="group"
          aria-label="Pull requests"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          {rows.map((item) => (
            <CandidateRow
              key={`${item.repo}#${item.number}`}
              pull={{ repo: item.repo, number: item.number }}
              title={item.title}
              state={item.state}
              sources={sourcesFor(item.repo, item.number)}
              disabled={disabled}
              onChoose={onChoose}
            />
          ))}
        </div>
      ) : items !== null && direct === null ? (
        <p className="text-xs text-muted-foreground">
          No tracked pull requests match.
        </p>
      ) : null}
    </div>
  );
}

function CandidateRow({
  pull,
  title,
  state,
  sources,
  disabled,
  onChoose,
}: {
  pull: PullRef;
  title: string | null;
  state: string | null;
  sources: Array<"workspace" | "review">;
  disabled: boolean;
  onChoose: (pull: PullRef) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChoose({ repo: pull.repo, number: pull.number })}
      className="flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 pointer-coarse:py-3"
    >
      <span className="flex w-full flex-wrap items-start gap-x-2 text-sm">
        <span className="min-w-0 break-all font-mono text-xs leading-5 text-muted-foreground">
          {pull.repo}#{pull.number}
        </span>
        <span className="min-w-0 flex-1 text-foreground">
          {title ?? "Title not loaded yet"}
        </span>
      </span>
      {state !== null || sources.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {state !== null ? <PullStateBadge state={state} /> : null}
          {sources.map((source) => (
            <Badge key={source} variant="secondary" className="font-normal">
              {SOURCE_LABELS[source]}
            </Badge>
          ))}
        </span>
      ) : null}
    </button>
  );
}

const TAP_TARGET = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

function PanelButton({
  children,
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size="sm"
      variant={variant}
      className={`h-8 px-2.5 text-xs font-normal ${TAP_TARGET}`}
      {...props}
    >
      {children}
    </Button>
  );
}

function RefreshPanelButton({
  busy,
  onRefresh,
}: {
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className={`h-8 shrink-0 gap-1.5 px-2.5 text-xs ${TAP_TARGET}`}
      aria-busy={busy}
      onClick={() => {
        if (!busy) onRefresh();
      }}
    >
      <RefreshIcon
        className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
      />
      {busy ? "Refreshing…" : "Refresh"}
    </Button>
  );
}

function FetchedTime({ detail }: { detail: PullDetailState }) {
  useMinuteTick();
  if (detail.fetchedAt === null) {
    return <span>{detail.refreshing ? "Fetching…" : "Not fetched yet"}</span>;
  }
  return (
    <span>
      Fetched{" "}
      <time
        dateTime={detail.fetchedAt}
        title={new Date(detail.fetchedAt).toLocaleString()}
      >
        {relativeTime(detail.fetchedAt)}
      </time>
      {detail.error !== null ? " · refresh failed" : ""}
    </span>
  );
}

function provenanceLabel(resolution: PullAssociation["resolution"]): string {
  if (resolution.kind === "selected") return "Your saved choice";
  if (resolution.kind !== "candidate") return "";
  const workspace = resolution.sources.includes("workspace");
  const review = resolution.sources.includes("review");
  if (workspace && review)
    return "Matched by workspace branch and review thread";
  return workspace ? "Matched by workspace branch" : "Linked by review thread";
}

const FAILURE_SOURCE_LABELS: Record<
  PullAssociation["failures"][number]["source"],
  string
> = {
  selection: "your saved choice",
  workspace: "the workspace branch",
  review: "review threads",
};

function isPermissionFailure(message: string): boolean {
  return /HTTP 403|forbidden|SAML|resource not accessible/i.test(message);
}

function FailureNotice({
  reason,
  message,
  where,
}: {
  reason: "auth" | "unavailable" | "lookup";
  message: string;
  where: "workspace" | "plugin";
}) {
  const machine =
    where === "workspace"
      ? "the machine that hosts this thread’s workspace"
      : PLUGIN_MACHINE;
  if (reason === "auth" && isPermissionFailure(message)) {
    return (
      <Notice tone="error">
        <b>GitHub access needed.</b> <code>gh</code> is signed in on {machine},
        but that GitHub account can’t read this repository. Ask for access, or
        authorize it for the organization’s single sign-on (for example{" "}
        <code>gh auth refresh -h github.com</code>), then Refresh.
        <span className="mt-1 block text-muted-foreground">
          Details: {message}
        </span>
      </Notice>
    );
  }
  if (reason === "auth") {
    return (
      <Notice tone="error">
        <b>GitHub sign-in needed.</b> <code>gh</code> isn’t signed in on{" "}
        {machine}, so this session’s pull request is unknown. Run{" "}
        <code>gh auth login</code> there, then Refresh.
        <span className="mt-1 block text-muted-foreground">
          Details: {message}
        </span>
      </Notice>
    );
  }
  if (reason === "unavailable") {
    return (
      <Notice tone="warn">
        <b>
          {where === "workspace"
            ? "The workspace is unavailable."
            : "GitHub is unavailable."}
        </b>{" "}
        This session’s pull request is unknown right now. Refresh to try again.
        <span className="mt-1 block text-muted-foreground">
          Details: {message}
        </span>
      </Notice>
    );
  }
  return (
    <Notice tone="error">
      <b>Couldn’t look up this session’s pull request.</b>
      <span className="mt-1 block text-muted-foreground">
        Details: {message}
      </span>
    </Notice>
  );
}

function failureLocation(
  association: PullAssociation | null,
  reason: string,
): "workspace" | "plugin" {
  const failure = association?.failures.find(
    (entry) => entry.reason === reason,
  );
  return failure?.runsOn === "workspace" ? "workspace" : "plugin";
}

function PullPanelTab({ threadId }: PluginThreadPanelProps) {
  return <SessionPullPanel key={threadId} threadId={threadId} />;
}

function SessionPullPanel({ threadId }: { threadId: string }) {
  const session = usePullAssociation(threadId);
  const { items } = useItems("pr");
  const [choosing, setChoosing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [returnFocus, setReturnFocus] = useState(0);
  const [saveFailed, setSaveFailed] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement>(null);
  const { association } = session;

  useEffect(() => {
    if (choosing) chooserHeadingRef.current?.focus();
  }, [choosing]);
  useEffect(() => {
    if (returnFocus === 0) return;
    containerRef.current
      ?.querySelector<HTMLElement>("[data-return-focus]")
      ?.focus();
  }, [returnFocus]);
  useEffect(() => {
    if (saveFailed === 0) return;
    const container = containerRef.current;
    (
      container?.querySelector<HTMLElement>("[data-save-error]") ??
      container?.querySelector<HTMLElement>("[data-return-focus]")
    )?.focus();
  }, [saveFailed]);
  const previousError = useRef<string | null>(null);
  useEffect(() => {
    if (
      session.error !== null &&
      session.error !== previousError.current &&
      association !== null
    ) {
      setAnnouncement("Couldn’t refresh this session’s pull request match.");
    }
    previousError.current = session.error;
  }, [session.error, association]);

  const closeChooser = useCallback(() => {
    setChoosing(false);
    setReturnFocus((count) => count + 1);
  }, []);

  const choose = useCallback(
    (pull: PullRef | null) => {
      setAnnouncement(
        pull === null
          ? "Clearing your saved choice…"
          : `Checking ${pull.repo}#${pull.number} on GitHub…`,
      );
      void session.choose(pull).then((saved) => {
        if (!saved) {
          setAnnouncement("Couldn’t save that choice.");
          setSaveFailed((count) => count + 1);
          return;
        }
        closeChooser();
        setAnnouncement(
          pull === null
            ? "Saved choice cleared. Using automatic matching."
            : `Saved ${pull.repo}#${pull.number} for this session.`,
        );
      });
    },
    [session, closeChooser],
  );

  const titleFor = (repo: string, number: number) =>
    items?.find(
      (item) =>
        item.number === number &&
        item.repo.toLowerCase() === repo.toLowerCase(),
    ) ?? null;

  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (association === null) {
    return (
      <div ref={containerRef} className="flex flex-col gap-3">
        {liveRegion}
        {session.error !== null ? (
          <>
            <SessionHeading busy={session.loading} onRefresh={session.reload} />
            <FailureNotice
              reason={classifyGhFailure(session.error)}
              message={session.error}
              where="plugin"
            />
          </>
        ) : (
          <DetailSkeleton />
        )}
      </div>
    );
  }

  const { resolution, selection, candidates, failures } = association;
  const shown =
    resolution.kind === "selected" || resolution.kind === "candidate"
      ? { repo: resolution.repo, number: resolution.number }
      : null;
  const staleMatch =
    session.error !== null ? (
      <Notice tone="warn">
        <b>Couldn’t refresh this session’s match.</b> Showing the last known
        result; it may be out of date.
        <span className="mt-1 block text-muted-foreground">
          Details: {session.error}
        </span>
      </Notice>
    ) : null;
  const saveError =
    session.saveError !== null ? (
      <div tabIndex={-1} data-save-error className="focus:outline-none">
        <Notice tone="error" urgent>
          Couldn’t save that choice. {describeGhError(session.saveError)}
        </Notice>
      </div>
    ) : null;
  const chooser = choosing ? (
    <section
      aria-labelledby={`${threadId}-chooser`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id={`${threadId}-chooser`}
          ref={chooserHeadingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 text-sm font-medium text-foreground focus:outline-none"
        >
          Choose this session’s pull request
        </h2>
        <PanelButton
          variant="outline"
          disabled={session.saving}
          onClick={closeChooser}
        >
          {session.saving ? "Saving…" : "Cancel"}
        </PanelButton>
      </div>
      {saveError}
      {session.saving ? (
        <p className="text-xs text-muted-foreground">
          Checking on GitHub. This can’t be cancelled once started.
        </p>
      ) : null}
      <PullChooser
        candidates={candidates}
        disabled={session.saving}
        onChoose={choose}
      />
    </section>
  ) : null;

  if (shown === null) {
    const candidateRows = candidates.map((candidate) => {
      const cached = titleFor(candidate.repo, candidate.number);
      return (
        <CandidateRow
          key={`${candidate.repo}#${candidate.number}`}
          pull={candidate}
          title={cached?.title ?? null}
          state={cached?.state ?? null}
          sources={candidate.sources}
          disabled={session.saving}
          onChoose={choose}
        />
      );
    });
    const selectionUnreadable = failures.some(
      (failure) => failure.source === "selection",
    );
    return (
      <div ref={containerRef} className="flex flex-col gap-3">
        {liveRegion}
        <SessionHeading busy={session.loading} onRefresh={session.reload} />
        {staleMatch}
        {chooser ?? (
          <>
            {saveError}
            {resolution.kind === "ambiguous" ? (
              <p className="text-sm text-foreground">
                {candidates.length === 1
                  ? "A review thread links this pull request, but its identity can’t be confirmed. Choose it if it’s right:"
                  : `${candidates.length} pull requests match this session. Choose one:`}
              </p>
            ) : resolution.kind === "none" ? (
              <p className="text-sm text-foreground">
                No pull request matches this session’s workspace branch or
                review threads.
              </p>
            ) : resolution.kind === "failed" ? (
              <FailureNotice
                reason={resolution.reason}
                message={resolution.message}
                where={failureLocation(association, resolution.reason)}
              />
            ) : null}
            {resolution.kind === "failed" && candidates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                The lookup was incomplete. These were found; choose one only if
                it’s right:
              </p>
            ) : null}
            {candidateRows.length > 0 ? (
              <div
                role="group"
                aria-label="Matching pull requests"
                className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
              >
                {candidateRows}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <PanelButton
                variant="outline"
                data-return-focus
                onClick={() => setChoosing(true)}
              >
                Choose a PR…
              </PanelButton>
              {selectionUnreadable ? (
                <PanelButton
                  disabled={session.saving}
                  onClick={() => choose(null)}
                >
                  Use automatic matching
                </PanelButton>
              ) : null}
            </div>
          </>
        )}
      </div>
    );
  }

  const shownKey = `${shown.repo.toLowerCase()}#${shown.number}`;
  const workspaceMatch = candidates.some(
    (candidate) =>
      `${candidate.repo.toLowerCase()}#${candidate.number}` === shownKey &&
      candidate.sources.includes("workspace"),
  );
  const otherCandidates = candidates.filter(
    (candidate) =>
      `${candidate.repo.toLowerCase()}#${candidate.number}` !== shownKey,
  );
  const expectedId =
    resolution.kind === "selected"
      ? (selection?.id ?? null)
      : resolution.kind === "candidate"
        ? resolution.id
        : null;
  const notices = (
    <>
      {staleMatch}
      {chooser === null ? saveError : null}
      {resolution.kind === "selected" && otherCandidates.length > 0 ? (
        <Notice tone="info">
          Also matching this session:{" "}
          {otherCandidates
            .map(
              (candidate) =>
                `${candidate.repo}#${candidate.number} (${candidate.sources
                  .map((source) => SOURCE_LABELS[source])
                  .join(", ")})`,
            )
            .join("; ")}
          .
        </Notice>
      ) : null}
      {resolution.kind === "selected" && failures.length > 0 ? (
        <Notice tone="warn">
          Couldn’t check{" "}
          {failures
            .map((failure) => FAILURE_SOURCE_LABELS[failure.source])
            .join(" or ")}
          , so other matches are unknown.
          <span className="mt-1 block text-muted-foreground">
            Details: {failures[0].message}
          </span>
        </Notice>
      ) : null}
    </>
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {liveRegion}
      {chooser}
      <SessionPullDetail
        key={shownKey}
        repo={shown.repo}
        number={shown.number}
        expectedId={expectedId}
        provenance={provenanceLabel(resolution)}
        saved={selection !== null}
        saving={session.saving}
        choosing={choosing}
        environmentId={workspaceMatch ? association.environmentId : null}
        notices={notices}
        onReloadAssociation={session.reload}
        onChange={() => setChoosing(true)}
        onClear={() => choose(null)}
        onAnnounce={setAnnouncement}
      />
    </div>
  );
}

function SessionHeading({
  busy,
  onRefresh,
}: {
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="min-w-0 flex-1 text-sm font-medium text-foreground">
        Session pull request
      </h2>
      <RefreshPanelButton busy={busy} onRefresh={onRefresh} />
    </div>
  );
}

function SessionPullDetail({
  repo,
  number,
  expectedId,
  provenance,
  saved,
  saving,
  choosing,
  environmentId,
  notices,
  onReloadAssociation,
  onChange,
  onClear,
  onAnnounce,
}: {
  repo: string;
  number: number;
  expectedId: string | null;
  provenance: string;
  saved: boolean;
  saving: boolean;
  choosing: boolean;
  environmentId: string | null;
  notices: React.ReactNode;
  onReloadAssociation: () => void;
  onChange: () => void;
  onClear: () => void;
  onAnnounce: (message: string) => void;
}) {
  const detail = usePullDetail(repo, number);
  const clearHintId = useId();
  const identityProblem =
    expectedId === null || detail.pull === null
      ? null
      : detail.pull.id === ""
        ? "GitHub didn’t return an id for this pull request, so it can’t be confirmed as the one linked to this session."
        : detail.pull.id !== expectedId
          ? `${repo}#${number} is no longer the pull request linked to this session. The repository may have been renamed or reused.`
          : null;
  const userRefresh = useRef(false);
  const wasRefreshing = useRef(detail.refreshing);
  useEffect(() => {
    if (wasRefreshing.current && !detail.refreshing && userRefresh.current) {
      userRefresh.current = false;
      onAnnounce(
        identityProblem ??
          (detail.error === null
            ? "Pull request details refreshed."
            : "Refreshing pull request details failed. Showing earlier data."),
      );
    }
    wasRefreshing.current = detail.refreshing;
  }, [detail.refreshing, detail.error, identityProblem, onAnnounce]);

  return (
    <>
      <div className="flex flex-col gap-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col pt-1">
            <span className="font-medium text-foreground">{provenance}</span>
            <FetchedTime detail={detail} />
          </div>
          <RefreshPanelButton
            busy={detail.refreshing}
            onRefresh={() => {
              userRefresh.current = true;
              detail.refresh();
              onReloadAssociation();
            }}
          />
        </div>
        {choosing ? null : (
          <div className="-mx-1 flex flex-wrap items-center gap-1">
            <PanelButton disabled={saving} data-return-focus onClick={onChange}>
              Change…
            </PanelButton>
            {saved ? (
              <PanelButton
                disabled={saving}
                aria-describedby={clearHintId}
                onClick={onClear}
              >
                Use automatic matching
              </PanelButton>
            ) : null}
          </div>
        )}
        {saved && !choosing ? (
          <p id={clearHintId} className="pb-1">
            Clears your saved choice. The panel then follows the workspace
            branch and review threads, which may show this same PR.
          </p>
        ) : null}
      </div>
      {notices}
      {identityProblem !== null ? (
        <>
          <Notice tone="error" urgent>
            {identityProblem} Choose again.
          </Notice>
          {choosing ? null : (
            <PanelButton variant="outline" onClick={onChange}>
              Choose a PR…
            </PanelButton>
          )}
        </>
      ) : detail.pull === null ? (
        detail.error !== null ? (
          <FailureNotice
            reason={classifyGhFailure(detail.error)}
            message={detail.error}
            where="plugin"
          />
        ) : (
          <DetailSkeleton />
        )
      ) : (
        <PullDetailBody
          repo={repo}
          number={number}
          detail={detail}
          pull={detail.pull}
          compact
          readOnly
          workspaceEnvironmentId={environmentId}
        />
      )}
    </>
  );
}

function NewIssueForm({
  repos,
  onCreated,
  onCancel,
}: {
  repos: RepoInfo[];
  onCreated: (repo: string, number: number | null) => void;
  onCancel: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [repo, setRepo] = useState(repos[0]?.repo ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);

  const create = useCallback(() => {
    setCreating(true);
    rpc
      .call("createIssue", { repo, title, body })
      .then((result) => {
        toast.success("Issue created");
        onCreated(repo, result.number);
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setCreating(false));
  }, [rpc, repo, title, body, onCreated]);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">New issue</h2>
      <Select value={repo} onValueChange={setRepo}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Repository" />
        </SelectTrigger>
        <SelectContent>
          {repos.map((entry) => (
            <SelectItem key={entry.repo} value={entry.repo}>
              {entry.repo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Description (markdown)"
        rows={8}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={creating || title.trim().length === 0 || repo.length === 0}
          onClick={create}
        >
          {creating ? "Creating…" : "Create issue"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function useStatus(): { status: Status | null; refetch: () => void } {
  const rpc = useRpc<typeof githubRpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const refetch = useCallback(() => {
    rpc.call("status").then(
      (result) => setStatus(result),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return { status, refetch };
}

function PanelHeader() {
  const rpc = useRpc<typeof githubRpcContract>();
  const { status } = useStatus();
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    setSyncing(true);
    setFailed(false);
    rpc
      .call("refresh")
      .catch(() => setFailed(true))
      .finally(() => setSyncing(false));
  }, [rpc]);
  return (
    <>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {failed ? (
          "Sync failed — check `gh auth status`"
        ) : status === null ? (
          <DelayedLoading>Loading…</DelayedLoading>
        ) : status.ghOk ? (
          `${status.repos.length} repo${status.repos.length === 1 ? "" : "s"} · synced ${
            status.lastSyncedAt !== null
              ? relativeTime(status.lastSyncedAt)
              : "never"
          }`
        ) : status.ghState === "unavailable" ? (
          "GitHub CLI unavailable — retrying"
        ) : (
          "GitHub CLI not authenticated"
        )}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="size-8 gap-1.5 px-0 sm:h-8 sm:w-auto sm:px-3"
        disabled={syncing}
        onClick={refresh}
        aria-label={syncing ? "Syncing GitHub data" : "Refresh GitHub data"}
      >
        <RefreshIcon className={syncing ? "animate-spin" : undefined} />
        <span className="hidden sm:inline">
          {syncing ? "Syncing…" : "Refresh"}
        </span>
      </Button>
    </>
  );
}

const QUERY_KEY = "bb-plugin-github:query";
const DEFAULT_QUERY = "is:open ";

function GithubPanel({ subPath }: PluginNavPanelProps) {
  const [route, navigate] = useSubPathRoute(subPath);
  const { status } = useStatus();
  const [query, setQueryState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(QUERY_KEY) ?? DEFAULT_QUERY;
    } catch {
      return DEFAULT_QUERY;
    }
  });
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    try {
      window.localStorage.setItem(QUERY_KEY, next);
    } catch {}
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <GithubPanelBody
          route={route}
          navigate={navigate}
          status={status}
          query={query}
          setQuery={setQuery}
        />
      </div>
    </div>
  );
}

function ListView({
  kind,
  query,
  setQuery,
  repos,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  query: string;
  setQuery: (query: string) => void;
  repos: RepoInfo[];
  onOpenItem: (repo: string, number: number) => void;
}) {
  const { items, error } = useItems(kind);
  const viewer = useViewer();
  const parsed = useMemo(() => parseQuery(query), [query]);
  const filtered = useMemo(
    () =>
      items === null
        ? null
        : items.filter((item) => matchesQuery(item, parsed, viewer)),
    [items, parsed, viewer],
  );
  return (
    <>
      <FilterBar
        value={query}
        onChange={setQuery}
        items={items}
        repos={repos}
        kind={kind}
      />
      <ItemsTable
        kind={kind}
        items={filtered}
        error={error}
        hasFilter={query.trim().length > 0}
        onOpenItem={onOpenItem}
      />
    </>
  );
}

function GithubPanelBody({
  route,
  navigate,
  status,
  query,
  setQuery,
}: {
  route: Route;
  navigate: (route: Route) => void;
  status: Status | null;
  query: string;
  setQuery: (query: string) => void;
}) {
  const openItem = useCallback(
    (itemKind: "issue" | "pr", repo: string, number: number) => {
      navigate(
        itemKind === "pr"
          ? { view: "pull", repo, number }
          : { view: "issue", repo, number },
      );
    },
    [navigate],
  );
  if (status !== null && status.ghState === "unavailable") {
    return (
      <EmptyState
        message={`GitHub CLI could not reach GitHub. Check your network or keychain; the plugin retries by itself. (${status.ghError ?? ""})`}
      />
    );
  }
  if (status !== null && !status.ghOk) {
    return (
      <EmptyState
        message={`GitHub CLI is not available or not authenticated. Install it from cli.github.com, run \`gh auth login\`, then reload the plugin. (${status.ghError ?? ""})`}
      />
    );
  }
  if (status !== null && status.repos.length === 0) {
    return (
      <EmptyState message="No GitHub repos tracked yet. Create a Cloudroom project whose checkout has a GitHub origin remote, or add repos via the extraRepos plugin setting." />
    );
  }

  if (route.view === "issue") {
    return (
      <IssueDetailView
        repo={route.repo}
        number={route.number}
        onBack={() => navigate({ view: "issues" })}
      />
    );
  }
  if (route.view === "pull") {
    return (
      <PullDetailView
        repo={route.repo}
        number={route.number}
        onBack={() => navigate({ view: "pulls" })}
      />
    );
  }
  if (route.view === "new") {
    return (
      <NewIssueForm
        repos={status?.repos ?? []}
        onCreated={(repo, number) =>
          navigate(
            number !== null
              ? { view: "issue", repo, number }
              : { view: "issues" },
          )
        }
        onCancel={() => navigate({ view: "issues" })}
      />
    );
  }

  const kind = route.view === "pulls" ? "pr" : "issue";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Tabs
          value={route.view}
          onValueChange={(value) => {
            navigate(
              value === "pulls" ? { view: "pulls" } : { view: "issues" },
            );
          }}
        >
          <TabsList>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="pulls">Pull requests</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        {route.view === "issues" ? (
          <Button size="sm" onClick={() => navigate({ view: "new" })}>
            New issue
          </Button>
        ) : null}
      </div>

      <ListView
        kind={kind}
        query={query}
        setQuery={setQuery}
        repos={status?.repos ?? []}
        onOpenItem={(repo, number) => openItem(kind, repo, number)}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    path: "github",
    component: GithubPanel,
    headerContent: PanelHeader,
  });
  app.slots.threadPanelAction({
    id: "pull",
    title: "GitHub PR",
    icon: "Github",
    component: PullPanelTab,
  });
});
