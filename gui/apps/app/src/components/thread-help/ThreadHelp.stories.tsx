import { useEffect, useRef } from "react";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { ThreadContextWindowIndicator } from "@/components/thread/timeline";
import { ThreadHelpButton, ThreadHelpPanel } from "./ThreadHelp";
import { relevantThreadHelpTopicIds } from "./thread-help-topics";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "thread/Thread Help",
};

const relevant = relevantThreadHelpTopicIds({
  isCloud: true,
  hasContextUsage: true,
  reconnecting: true,
  hostDisconnected: false,
  authRequired: false,
  startFailed: false,
  usageLimit: false,
});

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-80 rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
      {children}
    </div>
  );
}

function SearchPanel({ query }: { query: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector("input");
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [query]);
  return (
    <div ref={ref}>
      <ThreadHelpPanel relevantTopicIds={relevant} />
    </div>
  );
}

export const Panel = () => (
  <StoryCard>
    <StoryRow label="browse" hint="footer or header button, no search yet">
      <PanelFrame>
        <ThreadHelpPanel relevantTopicIds={relevant} />
      </PanelFrame>
    </StoryRow>
    <StoryRow label="contextual topic" hint="opened from the reconnecting pill">
      <PanelFrame>
        <ThreadHelpPanel
          initialTopicId="reconnecting"
          relevantTopicIds={relevant}
        />
      </PanelFrame>
    </StoryRow>
    <StoryRow label="search" hint="keyword match, title hits first">
      <PanelFrame>
        <SearchPanel query="sleep" />
      </PanelFrame>
    </StoryRow>
    <StoryRow label="no results" hint="explicit empty state">
      <PanelFrame>
        <SearchPanel query="kubernetes" />
      </PanelFrame>
    </StoryRow>
  </StoryCard>
);

export const InThread = () => (
  <div className="flex min-h-[70vh] flex-col justify-end gap-3 p-6">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <div className="flex items-center gap-2 justify-self-center self-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
        <span role="status">Reconnecting…</span>
        <span aria-hidden>·</span>
        <button type="button" className="underline underline-offset-2">
          Retry
        </button>
        <ThreadHelpButton
          label="About reconnecting"
          initialTopicId="reconnecting"
          relevantTopicIds={relevant}
          className="-mr-2"
        />
      </div>
      <div className="h-24 rounded-xl border bg-card" />
      <div className="flex items-center justify-between gap-2 pl-[15px] pr-3.5">
        <div className="flex min-w-0 items-center gap-0.5">
          <ThreadEnvironmentSummary
            projectName="cloudroom-gui"
            environmentLabel="Cloud"
            environmentIcon="Cloud"
          />
          <ThreadHelpButton
            label="About where this thread runs"
            align="start"
            className="max-md:hidden"
            initialTopicId="where-it-runs"
            relevantTopicIds={relevant}
          />
        </div>
        <div className="flex items-center gap-2">
          <ThreadContextWindowIndicator
            usage={{
              usedTokens: 142000,
              modelContextWindow: 200000,
              estimated: false,
            }}
          />
          <ThreadHelpButton
            label="Thread help"
            relevantTopicIds={relevant}
            listenToHash
          />
        </div>
      </div>
    </div>
  </div>
);
