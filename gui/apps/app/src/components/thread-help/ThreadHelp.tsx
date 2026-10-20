import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@cloudroom/shared-ui/popover";
import { Input } from "@cloudroom/shared-ui/input";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@cloudroom/shared-ui/chrome-style-tokens";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
  THREAD_HELP_DOCS,
  THREAD_HELP_TOPICS,
  searchThreadHelp,
  threadHelpTopic,
  threadHelpLinkFromHash,
  type ThreadHelpTopic,
  type ThreadHelpTopicId,
} from "./thread-help-topics";

const ROW_CLASS =
  "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:py-2.5";
const LINK_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded-xs text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:py-3 max-md:text-sm";

function DocsLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={LINK_CLASS}
      onClick={(event) => {
        event.preventDefault();
        openUrlInExternalBrowser(href);
      }}
    >
      {label}
      <Icon name="ArrowUpRight" className="size-3" aria-hidden />
      <span className="sr-only">(opens cloudroom.dev)</span>
    </a>
  );
}

function TopicRow({
  topic,
  onOpen,
}: {
  topic: ThreadHelpTopic;
  onOpen: (id: ThreadHelpTopicId) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-help-topic={topic.id}
        className={ROW_CLASS}
        onClick={() => onOpen(topic.id)}
      >
        <span className="text-xs font-medium text-foreground max-md:text-sm">
          {topic.title}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground max-md:text-sm">
          {topic.summary}
        </span>
      </button>
    </li>
  );
}

function TopicDetail({
  topic,
  onBack,
  onOpen,
}: {
  topic: ThreadHelpTopic;
  onBack: () => void;
  onOpen: (id: ThreadHelpTopicId) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(
    () => headingRef.current?.focus({ preventScroll: true }),
    [topic.id],
  );
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 text-xs max-md:gap-3 max-md:text-sm"
    >
      <button
        type="button"
        className={cn(LINK_CLASS, "w-fit no-underline")}
        onClick={onBack}
      >
        <Icon name="ChevronLeft" className="size-3" aria-hidden />
        All help topics
      </button>
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="text-sm font-medium text-foreground outline-none max-md:text-base"
      >
        {topic.title}
      </h3>
      <p className="text-muted-foreground">{topic.summary}</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground marker:text-border">
        {topic.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {topic.nextStep ? (
        <p>
          <span className="font-medium text-foreground">Next step: </span>
          <span className="text-muted-foreground">{topic.nextStep}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
        <DocsLink label={`Docs: ${topic.docs.label}`} href={topic.docs.href} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground max-md:text-sm">
          Related:
        </span>
        {topic.related.map((id) => {
          const related = threadHelpTopic(id);
          return related ? (
            <button
              key={id}
              type="button"
              className={cn(LINK_CLASS, "underline")}
              onClick={() => onOpen(id)}
            >
              {related.title}
            </button>
          ) : null;
        })}
      </div>
    </section>
  );
}

export interface ThreadHelpPanelProps {
  initialTopicId?: ThreadHelpTopicId | null;
  relevantTopicIds?: readonly ThreadHelpTopicId[];
}

export function ThreadHelpPanel({
  initialTopicId = null,
  relevantTopicIds = [],
}: ThreadHelpPanelProps) {
  const [topicId, setTopicId] = useState<ThreadHelpTopicId | null>(
    initialTopicId,
  );
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const returnFocusTo = useRef<ThreadHelpTopicId | null>(null);
  const statusId = useId();
  const topic = topicId ? threadHelpTopic(topicId) : null;

  useLayoutEffect(() => {
    if (topic || !listRef.current) return;
    listRef.current.scrollTop = listScroll.current;
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    if (id)
      listRef.current
        .querySelector<HTMLElement>(`[data-help-topic="${id}"]`)
        ?.focus({ preventScroll: true });
  }, [topic]);

  const openTopic = (id: ThreadHelpTopicId) => {
    if (!topic && listRef.current)
      listScroll.current = listRef.current.scrollTop;
    setTopicId(id);
  };

  if (topic) {
    return (
      <TopicDetail
        topic={topic}
        onOpen={openTopic}
        onBack={() => {
          returnFocusTo.current = topic.id;
          setTopicId(null);
        }}
      />
    );
  }

  const results = searchThreadHelp(query);
  const searching = query.trim() !== "";
  const relevant = searching
    ? []
    : relevantTopicIds
        .map(threadHelpTopic)
        .filter((item): item is ThreadHelpTopic => item !== null);
  const others = searching
    ? results
    : THREAD_HELP_TOPICS.filter((item) => !relevant.includes(item));

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Icon
          name="Search"
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search thread help"
          aria-describedby={statusId}
          placeholder="Search help"
          className="h-8 pl-7 text-xs max-md:h-10 max-md:text-base"
        />
      </div>
      <p id={statusId} role="status" className="sr-only">
        {!searching
          ? ""
          : results.length === 0
            ? `No help topics match “${query.trim()}”`
            : `${results.length} ${results.length === 1 ? "topic" : "topics"} found`}
      </p>
      <div ref={listRef} className="-mx-2 min-h-0 overflow-y-auto">
        {searching && results.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-3 text-xs text-muted-foreground max-md:text-sm">
            <p>
              No help topics match{" "}
              <span className="text-foreground">“{query.trim()}”</span>. Try
              cloud, context, limit, or reconnect.
            </p>
            <button
              type="button"
              className={LINK_CLASS}
              onClick={() => setQuery("")}
            >
              Show all topics
            </button>
            <DocsLink
              label="Browse the Cloudroom docs"
              href={THREAD_HELP_DOCS.index}
            />
          </div>
        ) : (
          <>
            {relevant.length > 0 ? (
              <>
                <h3 className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  For this thread
                </h3>
                <ul>
                  {relevant.map((item) => (
                    <TopicRow key={item.id} topic={item} onOpen={openTopic} />
                  ))}
                </ul>
                <h3 className="px-2 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  More topics
                </h3>
              </>
            ) : null}
            <ul>
              {others.map((item) => (
                <TopicRow key={item.id} topic={item} onOpen={openTopic} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function ThreadHelpHashLink({
  open,
  onLink,
}: {
  open: boolean;
  onLink: (topicId: ThreadHelpTopicId | null) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const link = threadHelpLinkFromHash(location.hash);
  const linked = link !== null;
  const linkedTopic = link?.topicId ?? null;
  const onLinkRef = useRef(onLink);
  useLayoutEffect(() => {
    onLinkRef.current = onLink;
  });
  const opened = useRef(false);

  useEffect(() => {
    if (linked) onLinkRef.current(linkedTopic);
  }, [linked, linkedTopic, location.key]);

  useEffect(() => {
    if (open) opened.current = true;
    else if (opened.current && linked) {
      opened.current = false;
      void navigate({ search: location.search, hash: "" }, { replace: true });
    }
  }, [open, linked, navigate, location.search]);

  return null;
}

export interface ThreadHelpButtonProps extends ThreadHelpPanelProps {
  label: string;
  className?: string;
  align?: "start" | "end";
  variant?: "inline" | "header";
  listenToHash?: boolean;
}

export function ThreadHelpButton({
  label,
  className,
  initialTopicId = null,
  relevantTopicIds,
  align = "end",
  variant = "inline",
  listenToHash = false,
}: ThreadHelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [openedTopic, setOpenedTopic] = useState(initialTopicId);

  const handleOpenChange = (next: boolean) => {
    if (next) setOpenedTopic(initialTopicId);
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {listenToHash ? (
        <ThreadHelpHashLink
          open={open}
          onLink={(topicId) => {
            setOpenedTopic(topicId);
            setOpen(true);
          }}
        />
      ) : null}
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            variant === "header"
              ? HEADER_ICON_BUTTON_CLASS
              : "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:-m-1.5 max-md:size-11 [&_[data-icon-root]]:size-3.5",
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            className,
          )}
        >
          <Icon name="CircleQuestion" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={variant === "header" ? "bottom" : "top"}
        align={align}
        sideOffset={8}
        mobileTitle="Thread help"
        aria-label="Thread help"
        collisionPadding={8}
        onFocusOutside={(event) => event.preventDefault()}
        className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-80 flex-col overflow-y-auto p-3 max-md:max-h-none max-md:w-full"
      >
        {open ? (
          <ThreadHelpPanel
            key={openedTopic ?? "list"}
            initialTopicId={openedTopic}
            relevantTopicIds={relevantTopicIds}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
