import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { BbHttpError } from "@cloudroom/sdk/browser";
import type { PromptDraftState } from "@cloudroom/client-core";
import type { PromptInput, ThreadQueuedMessage } from "@cloudroom/domain";
import type { ThreadTimelineResponse, TimelineRow } from "@cloudroom/server-contract";
import { threadQueuedMessagesQueryKey, threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { HttpError } from "./api";
import { isAbortLikeError } from "./mutation-errors";

export type SendFailureKind = "not-sent" | "unconfirmed" | "rejected" | "cancelled";

export function classifySendFailure(error: unknown, browserOfflineAtSend: boolean): SendFailureKind {
  if (isAbortLikeError(error)) return "cancelled";
  if (error instanceof HttpError || error instanceof BbHttpError) {
    if (error.status === 408) return "unconfirmed";
    return error.status >= 500 && !error.code ? "unconfirmed" : "rejected";
  }
  return browserOfflineAtSend ? "not-sent" : "unconfirmed";
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function promptInputText(input: readonly PromptInput[]): string {
  return normalize(input.map((part) => (part.type === "text" ? part.text : "")).join(" "));
}

interface DeliveryMatchTarget {
  text: string;
  baselineMaxSeq: number | null;
  baselineQueueIds: readonly string[];
  requestId: string | null;
}

export function isMessageDelivered(
  attempt: DeliveryMatchTarget,
  rows: readonly TimelineRow[],
  queue: readonly ThreadQueuedMessage[],
): boolean {
  if (attempt.requestId && queue.some((item) => item.id === attempt.requestId)) return true;
  const text = normalize(attempt.text);
  if (!text) return false;
  const baselineMaxSeq = attempt.baselineMaxSeq;
  const inTimeline =
    baselineMaxSeq !== null &&
    rows.some(
      (row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.sourceSeqStart > baselineMaxSeq &&
        normalize(row.text) === text,
    );
  return (
    inTimeline ||
    queue.some((item) => !attempt.baselineQueueIds.includes(item.id) && promptInputText(item.content) === text)
  );
}

export function captureDeliveryBaseline(queryClient: QueryClient, threadId: string) {
  return {
    baselineMaxSeq: queryClient.getQueryData<ThreadTimelineResponse>(threadTimelineQueryKey(threadId))?.maxSeq ?? null,
    baselineQueueIds: (queryClient.getQueryData<ThreadQueuedMessage[]>(threadQueuedMessagesQueryKey(threadId)) ?? []).map((item) => item.id),
  };
}

export interface DeliveryAttempt extends DeliveryMatchTarget {
  key: number;
  threadId: string;
  phase: "checking" | "not-found" | "delivered" | "not-sent";
  draft: PromptDraftState;
  attachmentCount: number;
  dedupes: boolean;
  resend: () => Promise<unknown>;
}

const attempts = new Map<string, DeliveryAttempt>();
const listeners = new Set<() => void>();
let nextKey = 1;

function emit(): void {
  for (const listener of listeners) listener();
}

export function recordDeliveryAttempt(attempt: Omit<DeliveryAttempt, "key">): void {
  attempts.set(attempt.threadId, { ...attempt, key: nextKey++ });
  emit();
}

export function updateDeliveryAttempt(threadId: string, key: number, patch: Partial<Pick<DeliveryAttempt, "phase">>): void {
  const current = attempts.get(threadId);
  if (!current || current.key !== key) return;
  attempts.set(threadId, { ...current, ...patch });
  emit();
}

export function clearDeliveryAttempt(threadId: string, key: number): void {
  if (attempts.get(threadId)?.key !== key) return;
  attempts.delete(threadId);
  emit();
}

export function settleDeliveryAttempt(threadId: string, text: string): void {
  const current = attempts.get(threadId);
  if (!current || normalize(current.text) !== normalize(text)) return;
  attempts.delete(threadId);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeliveryAttempt(threadId: string): DeliveryAttempt | null {
  return attempts.get(threadId) ?? null;
}

export function useDeliveryAttempt(threadId: string): DeliveryAttempt | null {
  return useSyncExternalStore(
    subscribe,
    () => getDeliveryAttempt(threadId),
    () => null,
  );
}

export function resetDeliveryAttemptsForTest(): void {
  attempts.clear();
  emit();
}
