import { useSyncExternalStore } from "react";
import { BbHttpError } from "@cloudroom/sdk/browser";
import type { PromptDraftState } from "@cloudroom/client-core";
import type { PromptInput, ThreadQueuedMessage } from "@cloudroom/domain";
import { HttpError } from "./api";
import { isAbortLikeError } from "./mutation-errors";

export type SendFailureKind = "unconfirmed" | "rejected" | "cancelled";

export function classifySendFailure(error: unknown): SendFailureKind {
  if (isAbortLikeError(error)) return "cancelled";
  if (error instanceof HttpError || error instanceof BbHttpError) {
    if (error.status === 408) return "unconfirmed";
    return error.status >= 500 && !error.code ? "unconfirmed" : "rejected";
  }
  return "unconfirmed";
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function promptInputText(input: readonly PromptInput[]): string {
  return normalize(input.map((part) => (part.type === "text" ? part.text : "")).join(" "));
}

export function isMessageDelivered(
  attempt: { requestId: string | null },
  queue: readonly ThreadQueuedMessage[],
): boolean {
  return attempt.requestId !== null && queue.some((item) => item.id === attempt.requestId);
}

export interface DeliveryAttempt {
  key: number;
  threadId: string;
  text: string;
  requestId: string | null;
  phase: "checking" | "not-found" | "delivered";
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
