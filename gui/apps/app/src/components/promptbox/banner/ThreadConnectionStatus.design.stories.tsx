import { useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { AnimatedBody } from "./AnimatedBody";
import { BannerActionSlot, PromptBannerActionButton } from "./prompt-banner-actions";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "./PromptStackCard";

export default { title: "design/Thread connection status" };

type Tone = "neutral" | "attention" | "problem" | "ok";

interface BannerSpec {
  icon: IconName;
  spin?: boolean;
  tone: Tone;
  status: string;
  meta?: string;
  details?: ReactNode;
  actions?: ReactNode;
  expanded?: boolean;
}

const TONE_ICON_CLASS: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  attention: "text-warning",
  problem: "text-destructive",
  ok: "text-success",
};

function StatusBanner({ icon, spin, tone, status, meta, details, actions, expanded = false }: BannerSpec) {
  const [isExpanded, setIsExpanded] = useState(expanded);
  const toggleId = useId();
  const bodyId = useId();
  const label = (
    <>
      <Icon name={icon} className={cn("size-3.5 shrink-0", TONE_ICON_CLASS[tone], spin && "animate-spin")} aria-hidden="true" />
      <span role="status" className="min-w-0 truncate">
        <span className="text-foreground">{status}</span>
        {meta ? <span className="text-muted-foreground"> · {meta}</span> : null}
      </span>
    </>
  );
  return (
    <PromptStackCard ariaLabel="Connection status" className="overflow-hidden" style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}>
      <div className={cn("flex items-center gap-0.5 text-xs text-muted-foreground", PROMPT_STACK_INLAY_INSET_CLASS)}>
        {details ? (
          <button
            type="button"
            id={toggleId}
            aria-expanded={isExpanded}
            aria-controls={bodyId}
            onClick={() => setIsExpanded((value) => !value)}
            className={cn("flex min-w-0 cursor-pointer items-center gap-1.5 text-xs hover:bg-state-hover", PROMPT_STACK_INLAY_SEGMENT_CLASS)}
          >
            {label}
            <Icon name="ChevronDown" className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
          </button>
        ) : (
          <div className={cn("flex min-w-0 items-center gap-1.5 text-xs", PROMPT_STACK_INLAY_SEGMENT_CLASS)}>{label}</div>
        )}
        {actions ? <BannerActionSlot hideInTiny={false}>{actions}</BannerActionSlot> : null}
      </div>
      {details ? (
        <AnimatedBody collapsedBorder="reserve" id={bodyId} labelledBy={toggleId} isExpanded={isExpanded}>
          <div className="space-y-1.5 px-3 pb-2.5 pt-2 text-xs leading-relaxed text-muted-foreground">{details}</div>
        </AnimatedBody>
      ) : null}
    </PromptStackCard>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <span className="text-foreground">{label}:</span> {children}
    </p>
  );
}

function Action({ children, primary, desktopOnly }: { children: ReactNode; primary?: boolean; desktopOnly?: boolean }) {
  return <PromptBannerActionButton className={cn("relative after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] sm:after:-inset-y-1", primary && "text-foreground", desktopOnly && "[[data-frame=mobile]_&]:hidden")}>{children}</PromptBannerActionButton>;
}

function UnconfirmedCard({ phase }: { phase: "checking" | "not-found" | "delivered" | "not-sent" }) {
  if (phase === "delivered") {
    return (
      <StatusBanner icon="CircleCheck" tone="ok" status="Delivered" meta="found in the conversation after reconnecting" actions={<Action>OK</Action>} />
    );
  }
  return (
    <PromptStackCard ariaLabel="Delivery unconfirmed" className="space-y-2 p-3 text-xs">
      <div className="flex items-start gap-2">
        <Icon name="CircleQuestion" className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{phase === "not-sent" ? "Not sent" : "Delivery unconfirmed"}</p>
          <p className="truncate rounded border border-border bg-background px-2 py-1 text-foreground">“Please also add a CSV header row” <span className="text-muted-foreground">+ 1 image</span></p>
          {phase === "checking" ? (
            <p className="text-muted-foreground">Cloudroom hasn't confirmed this message. It may or may not have arrived. Not connected right now; we'll check the conversation when the connection is back. Your text and image are still in the box below.</p>
          ) : phase === "not-sent" ? (
            <p className="text-muted-foreground">Your browser was offline, so the message never left this device. It's back in the box below. Send it when you're online.</p>
          ) : (
            <p className="text-muted-foreground">Reconnected, but this message isn't in the conversation yet. That doesn't prove it wasn't received. Sending again could post it twice.</p>
          )}
        </div>
      </div>
      {phase === "checking" ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-5.5"><Action>Refresh connection</Action></div>
      ) : null}
      {phase === "not-found" ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-5.5">
          <Action primary>Send again</Action>
          <Action>Check conversation</Action>
          <Action>Dismiss</Action>
        </div>
      ) : null}
    </PromptStackCard>
  );
}

function TimelineMock({ stale, empty, working }: { stale?: string; empty?: ReactNode; working?: boolean }) {
  if (empty) return <div className="flex flex-1 items-center justify-center px-4">{empty}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden px-4 pt-3 text-sm">
      <div className="self-end rounded-lg border border-border bg-surface-raised-solid px-3 py-2">Ship CSV export for the billing page. Make sure the build stays green.</div>
      <p className="flex items-center gap-1.5 text-muted-foreground"><Icon name="Terminal" className="size-3.5" aria-hidden="true" />Ran pnpm test billing</p>
      <p className="flex items-center gap-1.5 text-muted-foreground"><Icon name="Edit" className="size-3.5" aria-hidden="true" />Edited export-csv.ts</p>
      <p>Added the export button and a streaming CSV writer. Tests pass.</p>
      {working && !stale ? <p className="text-muted-foreground">Working…</p> : null}
      {stale ? (
        <p className="mt-1 flex items-center gap-1.5 self-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
          <Icon name="Clock" className="size-3" aria-hidden="true" />
          {stale}
        </p>
      ) : null}
    </div>
  );
}

function Composer({ draft }: { draft?: string }) {
  return (
    <div className="rounded-lg border border-border bg-popover p-3">
      <div className={cn("pb-3 text-sm", draft ? "text-foreground" : "text-subtle-foreground")}>{draft ?? "Ask for a follow-up"}</div>
      {draft ? <div className="mb-2 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"><Icon name="Image" className="size-3" aria-hidden="true" />chart.png</div> : null}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border px-2.5 py-1">6.1-Sol</span>
        <span>Medium</span>
      </div>
    </div>
  );
}

function Frame({ width, banner, timeline, draft }: { width: number; banner?: ReactNode; timeline: ReactNode; draft?: string }) {
  return (
    <div data-frame={width < 500 ? "mobile" : "desktop"} className="flex h-[500px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background" style={{ width }}>
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-xs text-muted-foreground">Ship CSV export for the billing page</div>
      {timeline}
      <div data-promptbox-shell="" className="grid gap-1.5 p-3">
        {banner}
        <Composer draft={draft} />
      </div>
    </div>
  );
}

function Scenario({ title, note, banner, timeline, draft }: { title: string; note: string; banner?: ReactNode; timeline: ReactNode; draft?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-[1140px] text-xs text-muted-foreground">{note}</p>
      <div className="flex items-start gap-6">
        <Frame width={720} banner={banner} timeline={timeline} draft={draft} />
        <Frame width={390} banner={banner} timeline={timeline} draft={draft} />
      </div>
    </section>
  );
}

const DRAFT = "Please also add a CSV header row";
const staleNote = "Saved copy from 2:14 PM · newer messages may be missing";

export function A_TransientReconnect() {
  return (
    <Scenario
      title="1 · Transient reconnect (first 10 s, cached conversation) — local and cloud threads alike"
      note="Evidence: realtime socket closed or missed a pong. Cause unknown, so we only say what we are doing. Silent during the grace period so socket flicker never chatters; screen readers hear only 'Not connected' if it lasts past 10 s. Applies to local threads too, which today show nothing."
      banner={<StatusBanner icon="Spinner" spin tone="neutral" status="Reconnecting…" />}
      timeline={<TimelineMock working />}
      draft={DRAFT}
    />
  );
}

export function B_CachedNotConnected() {
  return (
    <Scenario
      title="2 · Still not connected, cached conversation (after the 10 s grace period) — details shown expanded for review; collapsed by default"
      note="Same evidence, longer outage. The status row says 'Not connected' and shows truthful freshness. The cause stays 'Unknown' unless the browser reports offline. 'Refresh connection' reuses wsManager.reconnectNow() plus query invalidation. 'Working…' is replaced by a saved-copy marker because live state is unknown."
      banner={
        <StatusBanner
          icon="CloudOff"
          tone="attention"
          status="Not connected"
          expanded
          details={
            <>
              <Fact label="Last update">2:14 PM (3 minutes ago).</Fact>
              <Fact label="Cause">Unknown. The live connection closed without a reason. Retrying automatically.</Fact>
              <Fact label="Your draft">Still in the box below.</Fact>
            </>
          }
          actions={<Action primary>Refresh connection</Action>}
        />
      }
      timeline={<TimelineMock stale={staleNote} />}
      draft={DRAFT}
    />
  );
}

export function C_DeviceOffline() {
  return (
    <Scenario
      title="2b · Device reports offline (navigator.onLine === false)"
      note="Only the browser's offline signal unlocks this wording. A fetch TypeError alone stays 'Not connected'."
      banner={<StatusBanner icon="CloudOff" tone="attention" status="Your browser reports you're offline" actions={<Action>Refresh connection</Action>} />}
      timeline={<TimelineMock stale={staleNote} />}
      draft={DRAFT}
    />
  );
}

export function D_NoCachedData() {
  return (
    <Scenario
      title="3 · No cached data (thread never loaded on this device)"
      note="Today this shows an endless skeleton. Proposed: after the grace period the timeline shows an honest empty state with the same single action. The banner still owns the status."
      banner={<StatusBanner icon="CloudOff" tone="attention" status="Not connected" meta="retrying" actions={<Action primary>Refresh connection</Action>} />}
      timeline={
        <TimelineMock
          empty={
            <div className="max-w-xs space-y-1 text-center text-sm">
              <Icon name="CloudOff" className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-foreground">This conversation isn't saved on this device yet</p>
              <p className="text-xs text-muted-foreground">Refresh the connection to load it.</p>
            </div>
          }
        />
      }
    />
  );
}

export function E_AuthRequired() {
  return (
    <div className="space-y-10">
      <Scenario
        title="4 · Provider authorization needed (Codex / Cursor; Claude keeps its existing ClaudeSignIn card)"
        note="Evidence: cloud status authRequired or local providerAuthFailed. The connection to Cloudroom is fine, so the conversation is live and not marked stale. 'Connect' reuses the existing provider sign-in."
        banner={<StatusBanner icon="UserRound" tone="attention" status="Codex needs authorization" meta="your draft is kept" actions={<Action primary>Connect</Action>} />}
        timeline={<TimelineMock />}
        draft={DRAFT}
      />
    </div>
  );
}

export function F_HostUnavailable() {
  return (
    <div className="space-y-10">
      <Scenario
        title="5a · Host unreachable: phone cannot reach the Mac through the relay"
        note="Evidence: relay answers 503 with x-bb-tunnel-offline (no usable Mac tunnel). That does not prove the Mac is powered off, so we don't say so. 'Check again' only re-probes; it never moves the thread."
        banner={<StatusBanner icon="Laptop" tone="attention" status="Can't reach your Mac" meta="through the phone relay" actions={<Action>Check again</Action>} />}
        timeline={<TimelineMock stale={staleNote} />}
        draft={DRAFT}
      />
      <Scenario
        title="5b · Host reconnecting (server says host-reconnecting)"
        note="Evidence: thread runtime displayStatus 'host-reconnecting' with hostReconnectGraceExpiresAt. The app is connected; the host is not."
        banner={<StatusBanner icon="Laptop" tone="neutral" status="Waiting for this computer to reconnect" meta="until 2:16 PM" />}
        timeline={<TimelineMock />}
      />
    </div>
  );
}

export function G_StartingSession() {
  return (
    <Scenario
      title="6 · Starting / reconnecting cloud session"
      note="Evidence: cloud status starting or reconnecting. 'Refresh status' only refetches the status. It is visually and verbally separate from Retry start."
      banner={<StatusBanner icon="Spinner" spin tone="neutral" status="Cloud session reconnecting…" actions={<Action>Refresh status</Action>} />}
      timeline={<TimelineMock working />}
      draft={DRAFT}
    />
  );
}

export function H_FailedStart() {
  return (
    <Scenario
      title="7 · Confirmed failed start"
      note="Evidence: cloud status failedStart (and its error). This is the only state that says 'didn't start'. 'Retry start' starts the session again, so it is labelled as such and disabled while pending. It is never automatic. 'Refresh status' stays separate."
      banner={
        <StatusBanner
          icon="AlertTriangle"
          tone="problem"
          status="Cloud session didn't start"
          meta="Sandbox setup failed"
          details={
            <>
              <p className="whitespace-pre-wrap text-destructive">Sandbox setup failed: npm install exited with code 1.</p>
              <p>Retry start launches the session again. Your draft stays in the box below.</p>
              <div className="hidden [[data-frame=mobile]_&]:block"><Action>Refresh status</Action></div>
            </>
          }
          actions={
            <>
              <Action desktopOnly>Refresh status</Action>
              <Action primary>Retry start</Action>
            </>
          }
        />
      }
      timeline={<TimelineMock />}
      draft={DRAFT}
    />
  );
}

export function I_DeliveryUnconfirmed() {
  return (
    <div className="space-y-10">
      <Scenario
        title="8a · Delivery unconfirmed: still disconnected"
        note="The request may have reached the server but no answer came back (TypeError, timeout, or 5xx without a structured body). We never say 'failed'. This one card owns status and action while it shows, so the stack stays one card high on mobile. Text and attachments stay in the composer (existing guarded restore). Announced once."
        banner={<UnconfirmedCard phase="checking" />}
        timeline={<TimelineMock stale={staleNote} />}
        draft={DRAFT}
      />
      <Scenario
        title="8b · Reconnected, message not found"
        note="After reconnect we refetch the timeline and queue. 'Not found' is still not 'failed'. Manual decision: Send again (sends the original submission, then clears the composer only if it still holds that exact draft), Check conversation, or Dismiss (keeps the composer text). Cloud threads (normal path): Send again replays the original request with the same request ID, which the server deduplicates, so the warning reads 'Cloudroom will ignore it if it already arrived'. Local threads and the phone's Mac-off mode have no deduplication, so the duplicate warning stays."
        banner={<UnconfirmedCard phase="not-found" />}
        timeline={<TimelineMock />}
        draft={DRAFT}
      />
      <Scenario
        title="8d · Not sent (browser was offline at send time)"
        note="Only when the browser reported offline before the request left, or the server returned a structured rejection (existing lifecycle error copy). Plain retry is safe because nothing was received."
        banner={<UnconfirmedCard phase="not-sent" />}
        timeline={<TimelineMock stale={staleNote} />}
        draft={DRAFT}
      />
      <Scenario
        title="8c · Reconnected, message found"
        note="The message is in the conversation, so the identical restored draft is cleared (only if unchanged)."
        banner={<UnconfirmedCard phase="delivered" />}
        timeline={<TimelineMock />}
      />
    </div>
  );
}

export function J_Recovered() {
  return (
    <Scenario
      title="9 · Recovered"
      note="One polite announcement, then the row disappears after ~4 s. The stale marker is removed once the refetch lands."
      banner={<StatusBanner icon="CircleCheck" tone="ok" status="Reconnected" meta="conversation refreshed" />}
      timeline={<TimelineMock />}
      draft={DRAFT}
    />
  );
}

export function Z_CurrentCloudNotices() {
  return (
    <Scenario
      title="Current (reconstructed from ThreadDetailPromptArea.tsx:2135-2177): cloud thread with fetch TypeError"
      note="Today any fetch TypeError shows 'Offline · Reconnecting… · Retry'. A non-TypeError status error shows a red card with 'Reconnect'. Local threads show nothing at all."
      banner={
        <div className="flex items-center gap-2 justify-self-center rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
          <span role="status" className="flex items-center gap-2"><span className="text-foreground">Offline</span><span aria-hidden>·</span><span>Reconnecting…</span></span>
          <span aria-hidden>·</span>
          <button type="button" className="underline underline-offset-2">Retry</button>
        </div>
      }
      timeline={<TimelineMock working />}
      draft={DRAFT}
    />
  );
}
