import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { PromptDraftState } from "@cloudroom/client-core";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import { Icon } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import { threadQueuedMessagesQueryKey, threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import {
  classifySendFailure,
  clearDeliveryAttempt,
  isMessageDelivered,
  updateDeliveryAttempt,
  useDeliveryAttempt,
  type DeliveryAttempt,
} from "@/lib/send-delivery";
import { wsManager } from "@/lib/ws";
import { PromptBannerActionButton } from "./prompt-banner-actions";
import { PromptStackCard } from "./PromptStackCard";
import { PROMPT_BANNER_TOUCH_TARGET_CLASS } from "./ThreadConnectionStatus";

function useCachedQueryData<T>(queryKey: QueryKey): T | undefined {
  const queryClient = useQueryClient();
  return useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => queryClient.getQueryData<T>(queryKey),
  );
}

function Action({ primary, ...props }: ComponentProps<typeof PromptBannerActionButton> & { primary?: boolean }) {
  return <PromptBannerActionButton {...props} className={cn(PROMPT_BANNER_TOUCH_TARGET_CLASS, primary && "text-foreground")} />;
}

export function DeliveryUnconfirmedCard({
  threadId,
  draftInBox,
  clearDraftIfMatches,
}: {
  threadId: string;
  draftInBox: boolean;
  clearDraftIfMatches: (draft: PromptDraftState) => void;
}) {
  const attempt = useDeliveryAttempt(threadId);
  const socket = useServerConnectionState();
  const queryClient = useQueryClient();
  const queue = useCachedQueryData<ThreadQueuedMessage[]>(threadQueuedMessagesQueryKey(threadId));
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const checkFailed = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () =>
      [threadTimelineQueryKey(threadId), threadQueuedMessagesQueryKey(threadId)].some((queryKey) => {
        const state = queryClient.getQueryState(queryKey);
        return state?.status === "error" && state.fetchStatus !== "fetching";
      }),
  );

  const delivered =
    attempt !== null &&
    (attempt.phase === "checking" || attempt.phase === "not-found") &&
    isMessageDelivered(attempt, queue ?? []);

  useEffect(() => {
    if (!attempt || !delivered) return;
    updateDeliveryAttempt(threadId, attempt.key, { phase: "delivered" });
    clearDraftIfMatches(attempt.draft);
  }, [attempt, clearDraftIfMatches, delivered, threadId]);

  const checkConversation = useCallback(async (target: DeliveryAttempt) => {
    const keys = [threadTimelineQueryKey(threadId), threadQueuedMessagesQueryKey(threadId)];
    await Promise.all(keys.map((queryKey) => queryClient.refetchQueries({ queryKey, exact: true })));
    const answered = keys.every((queryKey) => queryClient.getQueryState(queryKey)?.status === "success");
    if (!answered) return;
    const items = queryClient.getQueryData<ThreadQueuedMessage[]>(keys[1]) ?? [];
    if (!isMessageDelivered(target, items)) updateDeliveryAttempt(threadId, target.key, { phase: "not-found" });
  }, [queryClient, threadId]);

  useEffect(() => {
    if (attempt?.phase !== "checking" || socket !== "connected") return;
    void checkConversation(attempt);
  }, [attempt, checkConversation, socket]);

  if (!attempt) return null;

  const dismiss = () => clearDeliveryAttempt(threadId, attempt.key);
  const sendAgain = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await attempt.resend();
      clearDraftIfMatches(attempt.draft);
      clearDeliveryAttempt(threadId, attempt.key);
    } catch (error) {
      const kind = classifySendFailure(error);
      if (kind === "unconfirmed") updateDeliveryAttempt(threadId, attempt.key, { phase: "checking" });
      else if (kind === "rejected") showMutationErrorToast({ error, fallbackMessage: "Cloudroom refused to send it again", lifecycleOperation: "send_message" });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (attempt.phase === "delivered") {
    return (
      <PromptStackCard ariaLabel="In Cloudroom's queue" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
        <Icon name="CircleCheck" className="size-3.5 shrink-0 text-success" aria-hidden="true" />
        <span role="status" className="min-w-0 flex-1 truncate">
          <span className="text-foreground">In Cloudroom's queue</span> · the server has this exact message
        </span>
        <Action onClick={dismiss}>OK</Action>
      </PromptStackCard>
    );
  }

  const attachments = attempt.attachmentCount === 0 ? "" : ` + ${attempt.attachmentCount} attachment${attempt.attachmentCount === 1 ? "" : "s"}`;
  const whereIsDraft = draftInBox ? "It's back in the box below." : "Its text is shown above.";
  const notSent = attempt.phase === "not-sent";
  const title = notSent ? "Not sent" : "Delivery unconfirmed";
  const body = notSent
    ? `Cloudroom didn't send it: only text messages work while your Mac is off. ${whereIsDraft} Remove the attachments to send the text now, or send it when your Mac is back.`
    : attempt.phase === "not-found"
      ? `Reconnected, but Cloudroom couldn't confirm this exact message arrived. Check the conversation above; not seeing it there doesn't prove it wasn't received. ${
          attempt.dedupes ? "Sending again is safe: Cloudroom ignores it if the first one arrived." : "Sending again could post it twice."
        }${checkFailed && !checking ? " Couldn't check the conversation just now." : ""}`
      : `Cloudroom hasn't confirmed this message. It may or may not have arrived. ${
          socket !== "connected"
            ? "We'll check the conversation when the connection is back."
            : checkFailed && !checking
              ? "Couldn't check the conversation just now."
              : "Checking the conversation now."
        } ${whereIsDraft}`;
  return (
    <PromptStackCard ariaLabel={title} className="space-y-2 p-3 text-xs">
      <div className="flex items-start gap-2">
        <Icon name={notSent ? "CloudOff" : "CircleQuestion"} className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p role="alert" className="text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="truncate rounded border border-border bg-background px-2 py-1 text-foreground">
            “{attempt.text}”<span className="text-muted-foreground">{attachments}</span>
          </p>
          <p className="text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-5.5">
        {attempt.phase === "checking" && socket !== "connected" ? (
          <Action primary onClick={() => wsManager.reconnectNow()}>Refresh connection</Action>
        ) : null}
        {attempt.phase === "not-found" ? (
          <Action primary disabled={sending} onClick={() => void sendAgain()}>
            {sending ? "Sending…" : "Send again"}
          </Action>
        ) : null}
        {attempt.phase === "not-found" || (attempt.phase === "checking" && socket === "connected") ? (
          <Action disabled={checking || sending} onClick={() => {
            setChecking(true);
            void checkConversation(attempt).finally(() => setChecking(false));
          }}>Check conversation</Action>
        ) : null}
        {attempt.phase !== "checking" ? <Action onClick={dismiss}>Dismiss</Action> : null}
      </div>
    </PromptStackCard>
  );
}
