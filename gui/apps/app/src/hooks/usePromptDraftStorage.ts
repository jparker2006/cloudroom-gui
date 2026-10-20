import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PromptTextMention } from "@cloudroom/domain";
import type { PromptDraftAttachment, PromptDraftState } from "@cloudroom/client-core";
import { readNewThreadRecord } from "./new-thread-draft-record";
import type {
  ThreadTimelineAddToChatHandler,
  ThreadTimelineAddToChatSource,
} from "@/components/thread/timeline/types";
import {
  appendMessageContextToDraft,
  appendPromptDraft,
  appendQuoteAndAttachmentsToDraft,
  arePromptDraftStatesEqual,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  serializePromptDraftStorage,
} from "@cloudroom/client-core";

const PROMPT_DRAFT_STORAGE_PREFIX = "bb.promptbox.contents";
const PROMPT_DRAFT_STORAGE_VERSION = "3";
const PROMPT_DRAFT_PERSIST_DEBOUNCE_MS = 250;

export type PromptDraftScope =
  | { kind: "automation-edit"; automationId: string }
  | { kind: "new-thread"; projectId?: string }
  | { kind: "plugin-new-thread"; key: string }
  | { kind: "thread"; projectId: string; threadId: string };

interface PromptDraftCacheEntry {
  rawValue: string | null;
  draft: PromptDraftState;
}

type PromptDraftListener = () => void;

interface PromptDraftWriteOptions {
  persist: "immediate" | "deferred";
}

const EMPTY_PROMPT_DRAFT = emptyPromptDraftState();
const promptDraftCache = new Map<string, PromptDraftCacheEntry>();
const promptDraftSubscribers = new Map<string, Set<PromptDraftListener>>();
const pendingPromptDraftStorageKeys = new Set<string>();
const promptDraftPersistTimers = new Map<string, number>();
let promptDraftStorageObserverInitialized = false;
const newThreadDraftRevs = new Map<string, string>();
const unsavedPromptDraftKeys = new Set<string>();
const promptDraftEditCounts = new Map<string, number>();
const lastOwnWrittenRevs = new Map<string, string>();

function promptDraftEditRevision(storageKey: string): string {
  return `${promptDraftEditCounts.get(storageKey) ?? 0}:${newThreadDraftRevs.get(storageKey) ?? ""}`;
}

function isUnchangedSinceSend(storageKey: string, sentRevision: string): boolean {
  if (typeof sentRevision !== "string") return false;
  const [editCount, sentRev] = sentRevision.split(":");
  if (editCount !== String(promptDraftEditCounts.get(storageKey) ?? 0)) return false;
  if (!isNewThreadProjectDraftKey(storageKey)) return true;
  const storedRev = readStoredRev(readStoredPromptDraftValue(storageKey));
  return (
    storedRev === undefined ||
    storedRev === sentRev ||
    storedRev === lastOwnWrittenRevs.get(storageKey)
  );
}
export type NewThreadDraftNotice = "sent-elsewhere" | "moved-elsewhere" | "unreadable";
const newThreadDraftNotices = new Map<string, NewThreadDraftNotice>();

function readPromptDraftStatus(storageKey: string): string {
  return `${unsavedPromptDraftKeys.has(storageKey) ? "unsaved" : "saved"}:${newThreadDraftNotices.get(storageKey) ?? ""}`;
}

function holdInMemory(
  storageKey: string,
  cachedEntry: PromptDraftCacheEntry,
  rawValue: string,
  notice: NewThreadDraftNotice,
): false {
  unsavedPromptDraftKeys.add(storageKey);
  newThreadDraftNotices.set(storageKey, notice);
  cachedEntry.rawValue = rawValue;
  return false;
}
const NEW_THREAD_DRAFT_KEY_PREFIX = `${PROMPT_DRAFT_STORAGE_PREFIX}-new-thread-`;

function isNewThreadProjectDraftKey(storageKey: string): boolean {
  return storageKey.startsWith(NEW_THREAD_DRAFT_KEY_PREFIX);
}

function createDraftRev(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readStoredRev(rawValue: string | null): string | undefined {
  if (rawValue === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const rev = (parsed as { rev?: unknown }).rev;
    return typeof rev === "string" ? rev : undefined;
  } catch {
    return undefined;
  }
}

function withDraftRev(storageKey: string, serialized: string): string {
  const rev = createDraftRev();
  const base = newThreadDraftRevs.get(storageKey);
  newThreadDraftRevs.set(storageKey, rev);
  return JSON.stringify({ ...JSON.parse(serialized), rev, ...(base ? { base } : {}) });
}

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function readPromptDraft(storageKey: string | null): PromptDraftState {
  if (!storageKey || typeof window === "undefined") {
    return EMPTY_PROMPT_DRAFT;
  }

  if (
    pendingPromptDraftStorageKeys.has(storageKey) ||
    unsavedPromptDraftKeys.has(storageKey)
  ) {
    return promptDraftCache.get(storageKey)?.draft ?? EMPTY_PROMPT_DRAFT;
  }

  const cachedEntry = promptDraftCache.get(storageKey);
  let rawValue: string | null;
  try {
    rawValue = window.localStorage.getItem(storageKey);
  } catch {
    return cachedEntry?.draft ?? EMPTY_PROMPT_DRAFT;
  }
  if (cachedEntry && cachedEntry.rawValue === rawValue) {
    return cachedEntry.draft;
  }

  const draft = parsePromptDraftStorage(rawValue);
  if (isNewThreadProjectDraftKey(storageKey)) {
    const rev = readStoredRev(rawValue);
    if (rev) newThreadDraftRevs.set(storageKey, rev);
    const recovered = cachedEntry ? null : findCloseTimeRecoveryCopy(storageKey, rev);
    if (recovered) {
      promotedRecoveryCopies.set(storageKey, recovered.key);
      promptDraftCache.set(storageKey, { rawValue, draft: recovered.draft });
      ensurePromptDraftStorageObserver();
      schedulePromptDraftPersist(storageKey);
      return recovered.draft;
    }
  }
  promptDraftCache.set(storageKey, {
    rawValue,
    draft,
  });
  return draft;
}

function emitPromptDraftChange(storageKey: string): void {
  const listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error(`[prompt-draft] a listener for ${storageKey} failed`, error);
    }
  }
}

function clearPromptDraftPersistTimer(storageKey: string): void {
  const timerId = promptDraftPersistTimers.get(storageKey);
  if (timerId === undefined || typeof window === "undefined") return;

  window.clearTimeout(timerId);
  promptDraftPersistTimers.delete(storageKey);
}

const queuedLockedPersists = new Set<string>();
const PROMPT_DRAFT_LOCK_TIMEOUT_MS = 2000;

function webLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

function persistPromptDraftCache(storageKey: string): void {
  if (typeof window === "undefined") return;
  const locks = webLocks();
  if (!locks || !isNewThreadProjectDraftKey(storageKey)) {
    persistPromptDraftCacheNow(storageKey);
    return;
  }

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.add(storageKey);
  if (queuedLockedPersists.has(storageKey)) return;
  queuedLockedPersists.add(storageKey);
  const runWrite = () => {
    queuedLockedPersists.delete(storageKey);
    if (pendingPromptDraftStorageKeys.has(storageKey)) persistPromptDraftCacheNow(storageKey);
  };
  locks
    .request(
      `bb.promptbox.write.${storageKey}`,
      { signal: AbortSignal.timeout(PROMPT_DRAFT_LOCK_TIMEOUT_MS) },
      runWrite,
    )
    .catch(runWrite);
}

function writeRecoveryCopyOnly(storageKey: string): void {
  const cachedEntry = promptDraftCache.get(storageKey);
  const serialized = cachedEntry && serializePromptDraftStorage(cachedEntry.draft);
  if (!serialized) return;
  const base = newThreadDraftRevs.get(storageKey);
  try {
    window.localStorage.setItem(
      newThreadRecoveryKey(storageKey),
      JSON.stringify({ ...JSON.parse(serialized), rev: createDraftRev(), ...(base ? { base } : {}) }),
    );
  } catch (error) {
    console.warn(`[prompt-draft] could not keep a recovery copy of ${storageKey}`, error);
  }
}

function persistPromptDraftCacheNow(storageKey: string): void {
  const wasUnsaved = unsavedPromptDraftKeys.has(storageKey);
  persistPromptDraftCacheNowQuietly(storageKey);
  if (unsavedPromptDraftKeys.has(storageKey) !== wasUnsaved) emitPromptDraftChange(storageKey);
}

function persistPromptDraftCacheNowQuietly(storageKey: string): void {

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.delete(storageKey);

  const cachedEntry = promptDraftCache.get(storageKey);
  if (!cachedEntry) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  if (
    isNewThreadProjectDraftKey(storageKey) &&
    !reconcileWithStoredNewThreadDraft(storageKey, cachedEntry)
  ) {
    return;
  }

  const confirmedRev = newThreadDraftRevs.get(storageKey);
  const plainSerialized = serializePromptDraftStorage(cachedEntry.draft);
  const serialized =
    plainSerialized !== null && isNewThreadProjectDraftKey(storageKey)
      ? withDraftRev(storageKey, plainSerialized)
      : plainSerialized;
  cachedEntry.rawValue = serialized;
  if (serialized === null) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  try {
    if (isNewThreadProjectDraftKey(storageKey)) {
      window.localStorage.setItem(newThreadRecoveryKey(storageKey), serialized);
    }
    window.localStorage.setItem(storageKey, serialized);
    unsavedPromptDraftKeys.delete(storageKey);
    const writtenRev = readStoredRev(serialized);
    if (writtenRev) lastOwnWrittenRevs.set(storageKey, writtenRev);
    if (newThreadDraftNotices.get(storageKey) !== "sent-elsewhere") {
      newThreadDraftNotices.delete(storageKey);
    }
    const promotedKey = promotedRecoveryCopies.get(storageKey);
    if (promotedKey) {
      promotedRecoveryCopies.delete(storageKey);
      window.localStorage.removeItem(promotedKey);
    }
  } catch (error) {
    if (confirmedRev === undefined) newThreadDraftRevs.delete(storageKey);
    else newThreadDraftRevs.set(storageKey, confirmedRev);
    unsavedPromptDraftKeys.add(storageKey);
    cachedEntry.rawValue = readStoredPromptDraftValue(storageKey);
    console.warn(
      `[prompt-draft] could not persist draft for ${storageKey}; keeping it in memory only`,
      error,
    );
  }
}

let promptDraftWindowId: string | null = null;

function newThreadProjectSegment(storageKey: string): string {
  return storageKey.slice(
    NEW_THREAD_DRAFT_KEY_PREFIX.length,
    -`-${PROMPT_DRAFT_STORAGE_VERSION}`.length,
  );
}

function newThreadRecoveryPrefix(storageKey: string): string {
  return `bb.promptbox.recovery-new-thread-${newThreadProjectSegment(storageKey)}-`;
}

function newThreadRecoveryKey(storageKey: string): string {
  promptDraftWindowId ??= createDraftRev();
  return `${newThreadRecoveryPrefix(storageKey)}${promptDraftWindowId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

function removeRecoveryCopiesWithRev(storageKey: string, rev: string): void {
  const prefix = newThreadRecoveryPrefix(storageKey);
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix) && readStoredRev(window.localStorage.getItem(key)) === rev) {
      window.localStorage.removeItem(key);
    }
  }
}

function newThreadConflictKey(storageKey: string, rev: string): string {
  return `bb.promptbox.conflict-new-thread-${newThreadProjectSegment(storageKey)}-${rev}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

function reconcileWithStoredNewThreadDraft(
  storageKey: string,
  cachedEntry: PromptDraftCacheEntry,
): boolean {
  const rawValue = readStoredPromptDraftValue(storageKey);
  if (rawValue === null) return true;
  const record = readNewThreadRecord(rawValue);
  if (record.kind === "unreadable") {
    return holdInMemory(storageKey, cachedEntry, rawValue, "unreadable");
  }
  if (
    (record.kind === "moved" || record.kind === "discarded") &&
    record.rev !== newThreadDraftRevs.get(storageKey)
  ) {
    return holdInMemory(storageKey, cachedEntry, rawValue, "moved-elsewhere");
  }
  if (record.kind === "missing" || record.kind === "moved" || record.kind === "discarded") {
    return true;
  }
  const storedRev = record.rev;
  if (storedRev) removeRecoveryCopiesWithRev(storageKey, storedRev);
  if (!storedRev) {
    if (
      record.kind === "draft" &&
      !isPromptDraftEmpty(record.draft) &&
      !arePromptDraftStatesEqual(record.draft, cachedEntry.draft)
    ) {
      const conflictKey = newThreadConflictKey(storageKey, createDraftRev());
      try {
        window.localStorage.setItem(conflictKey, rawValue);
      } catch (error) {
        console.warn(`[prompt-draft] could not keep the stored draft for ${storageKey}`, error);
        return holdInMemory(storageKey, cachedEntry, rawValue, "unreadable");
      }
    }
    return true;
  }
  if (storedRev === newThreadDraftRevs.get(storageKey)) {
    return true;
  }
  if (record.kind === "sent") {
    newThreadDraftNotices.set(storageKey, "sent-elsewhere");
    newThreadDraftRevs.set(storageKey, storedRev);
    return true;
  }

  const storedDraft = record.draft;
  if (arePromptDraftStatesEqual(storedDraft, cachedEntry.draft)) {
    newThreadDraftRevs.set(storageKey, storedRev);
    cachedEntry.rawValue = rawValue;
    return false;
  }

  if (!isPromptDraftEmpty(storedDraft)) {
    const conflictKey = newThreadConflictKey(storageKey, storedRev);
    if (readStoredPromptDraftValue(conflictKey) === null) {
      try {
        window.localStorage.setItem(conflictKey, rawValue);
      } catch (error) {
        unsavedPromptDraftKeys.add(storageKey);
        cachedEntry.rawValue = rawValue;
        console.warn(
          `[prompt-draft] could not keep the other window's draft for ${storageKey}; keeping this one in memory only`,
          error,
        );
        return false;
      }
    }
  }
  newThreadDraftRevs.set(storageKey, storedRev);
  return true;
}

function writeTerminalRecord(
  storageKey: string,
  value: string,
  checkedRev: string | undefined,
): boolean {
  const replacedRev = checkedRev;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch (error) {
    console.warn(`[prompt-draft] could not update ${storageKey}`, error);
    return false;
  }
  if (isNewThreadProjectDraftKey(storageKey)) {
    if (replacedRev) removeRecoveryCopiesWithRev(storageKey, replacedRev);
    window.localStorage.removeItem(newThreadRecoveryKey(storageKey));
  }
  return true;
}

function writeNewThreadSentMarker(storageKey: string, checkedRev: string | undefined): boolean {
  const marker = JSON.stringify({ rev: createDraftRev(), sent: true });
  if (!writeTerminalRecord(storageKey, marker, checkedRev)) return false;
  newThreadDraftRevs.set(storageKey, String(readStoredRev(marker)));
  promptDraftCache.set(storageKey, { rawValue: marker, draft: EMPTY_PROMPT_DRAFT });
  unsavedPromptDraftKeys.delete(storageKey);
  emitPromptDraftChange(storageKey);
  return true;
}

function keepNewThreadDraftOnIncomingChange(storageKey: string): boolean {
  const cachedEntry = promptDraftCache.get(storageKey);
  if (!cachedEntry || isPromptDraftEmpty(cachedEntry.draft)) return false;
  const rawValue = readStoredPromptDraftValue(storageKey);
  const record = readNewThreadRecord(rawValue);
  if (record.kind === "sent") {
    newThreadDraftNotices.set(storageKey, "sent-elsewhere");
    newThreadDraftRevs.set(storageKey, record.rev);
    cachedEntry.rawValue = rawValue;
    return true;
  }
  if ((record.kind === "moved" || record.kind === "discarded") && rawValue !== null) {
    holdInMemory(storageKey, cachedEntry, rawValue, "moved-elsewhere");
    return true;
  }
  if (record.kind === "unreadable" && rawValue !== null) {
    holdInMemory(storageKey, cachedEntry, rawValue, "unreadable");
    return true;
  }
  const myRev = newThreadDraftRevs.get(storageKey);
  if (
    record.kind === "draft" &&
    myRev &&
    readStoredBase(rawValue) !== myRev &&
    !arePromptDraftStatesEqual(record.draft, cachedEntry.draft)
  ) {
    const conflictKey = newThreadConflictKey(storageKey, myRev);
    const ownRecord = serializePromptDraftStorage(cachedEntry.draft);
    if (ownRecord !== null && readStoredPromptDraftValue(conflictKey) === null) {
      try {
        window.localStorage.setItem(
          conflictKey,
          JSON.stringify({ ...JSON.parse(ownRecord), rev: myRev }),
        );
      } catch (error) {
        if (rawValue !== null) holdInMemory(storageKey, cachedEntry, rawValue, "unreadable");
        console.warn(`[prompt-draft] could not keep this window's draft for ${storageKey}`, error);
        return true;
      }
    }
  }
  return false;
}

function readStoredBase(rawValue: string | null): string | undefined {
  if (rawValue === null) return undefined;
  try {
    const base = (JSON.parse(rawValue) as { base?: unknown }).base;
    return typeof base === "string" ? base : undefined;
  } catch {
    return undefined;
  }
}

const promotedRecoveryCopies = new Map<string, string>();

function findCloseTimeRecoveryCopy(
  storageKey: string,
  storedRev: string | undefined,
): { key: string; draft: PromptDraftState } | null {
  const prefix = newThreadRecoveryPrefix(storageKey);
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const rawValue = readStoredPromptDraftValue(key);
    const record = readNewThreadRecord(rawValue);
    if (
      record.kind === "draft" &&
      record.rev !== storedRev &&
      readStoredBase(rawValue) === storedRev &&
      !isPromptDraftEmpty(record.draft)
    ) {
      return { key, draft: record.draft };
    }
  }
  return null;
}

function readStoredPromptDraftValue(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function schedulePromptDraftPersist(storageKey: string): void {
  if (typeof window === "undefined") return;

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.add(storageKey);
  const timerId = window.setTimeout(() => {
    persistPromptDraftCache(storageKey);
  }, PROMPT_DRAFT_PERSIST_DEBOUNCE_MS);
  promptDraftPersistTimers.set(storageKey, timerId);
}

function flushPendingPromptDraftPersists(): void {
  for (const storageKey of Array.from(pendingPromptDraftStorageKeys)) {
    if (webLocks() && isNewThreadProjectDraftKey(storageKey)) {
      writeRecoveryCopyOnly(storageKey);
    } else {
      persistPromptDraftCacheNow(storageKey);
    }
  }
}

function ensurePromptDraftStorageObserver(): void {
  if (promptDraftStorageObserverInitialized || typeof window === "undefined") {
    return;
  }

  promptDraftStorageObserverInitialized = true;
  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (
      pendingPromptDraftStorageKeys.has(event.key) ||
      unsavedPromptDraftKeys.has(event.key)
    ) {
      return;
    }
    if (
      isNewThreadProjectDraftKey(event.key) &&
      keepNewThreadDraftOnIncomingChange(event.key)
    ) {
      emitPromptDraftChange(event.key);
      return;
    }
    promptDraftCache.delete(event.key);
    emitPromptDraftChange(event.key);
  });
  window.addEventListener("pagehide", flushPendingPromptDraftPersists);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPromptDraftPersists();
    }
  });
}

function subscribePromptDraft(
  storageKey: string | null,
  listener: PromptDraftListener,
): () => void {
  if (!storageKey) {
    return () => {};
  }

  ensurePromptDraftStorageObserver();

  let listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    promptDraftSubscribers.set(storageKey, listeners);
  }

  listeners.add(listener);
  return () => {
    const existingListeners = promptDraftSubscribers.get(storageKey);
    if (!existingListeners) return;

    existingListeners.delete(listener);
    if (existingListeners.size === 0) {
      promptDraftSubscribers.delete(storageKey);
    }
  };
}

function writePromptDraft(
  storageKey: string | null,
  value: PromptDraftState,
  options: PromptDraftWriteOptions = { persist: "immediate" },
): void {
  if (!storageKey || typeof window === "undefined") return;

  promptDraftEditCounts.set(storageKey, (promptDraftEditCounts.get(storageKey) ?? 0) + 1);
  promptDraftCache.set(storageKey, {
    rawValue: null,
    draft: isPromptDraftEmpty(value) ? EMPTY_PROMPT_DRAFT : value,
  });
  if (options.persist === "deferred") {
    schedulePromptDraftPersist(storageKey);
  } else {
    persistPromptDraftCache(storageKey);
  }
  emitPromptDraftChange(storageKey);
}

function restorePromptDraftIfEmpty(
  storageKey: string | null,
  value: PromptDraftState,
): boolean {
  if (
    !storageKey ||
    typeof window === "undefined" ||
    isPromptDraftEmpty(value)
  ) {
    return false;
  }

  if (!isPromptDraftEmpty(readPromptDraft(storageKey))) {
    return false;
  }

  writePromptDraft(storageKey, value);
  return true;
}

function addQuoteToPromptDraft(
  storageKey: string,
  text: string,
  attachments: readonly PromptDraftAttachment[] = [],
  source?: ThreadTimelineAddToChatSource,
): void {
  const currentDraft = readPromptDraft(storageKey);
  const nextDraft =
    source === undefined
      ? appendQuoteAndAttachmentsToDraft(currentDraft, text, attachments)
      : appendMessageContextToDraft(
          currentDraft,
          text,
          source.messageNumber,
          attachments,
        );
  if (nextDraft === currentDraft) {
    return;
  }

  writePromptDraft(storageKey, nextDraft);
}

function getPromptDraftStorageKey(scope: PromptDraftScope): string {
  if (scope.kind === "automation-edit") {
    const normalizedAutomationId = normalizeStorageSegment(scope.automationId);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-automation-edit-${normalizedAutomationId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  if (scope.kind === "new-thread") {
    if (scope.projectId === undefined) {
      return `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
    }
    const normalizedProjectId = normalizeStorageSegment(scope.projectId);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-new-thread-${normalizedProjectId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  if (scope.kind === "plugin-new-thread") {
    const normalizedKey = normalizeStorageSegment(scope.key);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-plugin-draft-${normalizedKey}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  const normalizedProjectId = normalizeStorageSegment(scope.projectId);
  const normalizedThreadId = normalizeStorageSegment(scope.threadId);
  return `${PROMPT_DRAFT_STORAGE_PREFIX}-${normalizedProjectId}-${normalizedThreadId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

export type MoveNewThreadDraftResult =
  | { status: "moved"; leftoverAttachments: string[] }
  | { status: "nothing-to-move" | "unreadable" | "failed" | "source-not-updated" };

export async function moveNewThreadDraft(
  sourceKey: string,
  targetProjectId: string,
): Promise<MoveNewThreadDraftResult> {
  if (sourceKey === getPromptDraftStorageKey({ kind: "new-thread", projectId: targetProjectId })) {
    return { status: "nothing-to-move" };
  }
  const locks = webLocks();
  if (!locks) return moveNewThreadDraftNow(sourceKey, targetProjectId);
  const targetKey = getPromptDraftStorageKey({ kind: "new-thread", projectId: targetProjectId });
  let started = false;
  try {
    return await locks.request(
      "bb.promptbox.move",
      { signal: AbortSignal.timeout(PROMPT_DRAFT_LOCK_TIMEOUT_MS) },
      () =>
        locks.request(`bb.promptbox.write.${targetKey}`, () =>
          locks.request(`bb.promptbox.write.${sourceKey}`, () => {
            started = true;
            return moveNewThreadDraftNow(sourceKey, targetProjectId);
          }),
        ),
    );
  } catch (error) {
    if (started) throw error;
    return moveNewThreadDraftNow(sourceKey, targetProjectId);
  }
}

function moveNewThreadDraftNow(
  sourceKey: string,
  targetProjectId: string,
): MoveNewThreadDraftResult {
  const targetKey = getPromptDraftStorageKey({ kind: "new-thread", projectId: targetProjectId });
  if (pendingPromptDraftStorageKeys.has(targetKey)) persistPromptDraftCacheNow(targetKey);
  if (
    pendingPromptDraftStorageKeys.has(sourceKey) ||
    (unsavedPromptDraftKeys.has(sourceKey) && !newThreadDraftNotices.has(sourceKey))
  ) {
    persistPromptDraftCacheNow(sourceKey);
  }
  if (unsavedPromptDraftKeys.has(sourceKey)) return { status: "failed" };

  const sourceRaw = readStoredPromptDraftValue(sourceKey);
  const source = readNewThreadRecord(sourceRaw);
  if (source.kind === "unreadable") return { status: "unreadable" };
  if (source.kind !== "draft" || isPromptDraftEmpty(source.draft)) {
    return { status: "nothing-to-move" };
  }

  const carried = source.draft.attachments.filter(
    (attachment) => (attachment as { projectId?: string }).projectId === targetProjectId,
  );
  const leftovers = source.draft.attachments.filter((attachment) => !carried.includes(attachment));
  const previousTarget = readPromptDraft(targetKey);
  const targetWasUnsaved = unsavedPromptDraftKeys.has(targetKey);
  const targetRecoveryKey = newThreadRecoveryKey(targetKey);
  const previousTargetRecovery = readStoredPromptDraftValue(targetRecoveryKey);
  promptDraftCache.set(targetKey, {
    rawValue: null,
    draft: appendPromptDraft(previousTarget, { ...source.draft, attachments: carried }),
  });
  unsavedPromptDraftKeys.delete(targetKey);
  persistPromptDraftCacheNow(targetKey);
  if (unsavedPromptDraftKeys.has(targetKey)) {
    promptDraftCache.set(targetKey, {
      rawValue: readStoredPromptDraftValue(targetKey),
      draft: previousTarget,
    });
    if (!targetWasUnsaved) unsavedPromptDraftKeys.delete(targetKey);
    try {
      if (previousTargetRecovery === null) window.localStorage.removeItem(targetRecoveryKey);
      else window.localStorage.setItem(targetRecoveryKey, previousTargetRecovery);
    } catch (error) {
      console.warn(`[prompt-draft] could not restore the recovery copy of ${targetKey}`, error);
    }
    emitPromptDraftChange(targetKey);
    return { status: "failed" };
  }

  const rev = createDraftRev();
  const sourceValue =
    leftovers.length > 0
      ? JSON.stringify({ text: "", attachments: leftovers, rev })
      : JSON.stringify({ rev, moved: true });
  if (!writeTerminalRecord(sourceKey, sourceValue, source.rev)) {
    emitPromptDraftChange(targetKey);
    return { status: "source-not-updated" };
  }
  if (sourceKey === LEGACY_NEW_THREAD_DRAFT_KEY) rememberMovedLegacyText(source.draft.text);
  promptDraftCache.delete(sourceKey);
  emitPromptDraftChange(targetKey);
  emitPromptDraftChange(sourceKey);
  return { status: "moved", leftoverAttachments: leftovers.map((attachment) => attachment.name) };
}

function discardBackupPrefix(storageKey: string, kind: "unreadable" | "discarded"): string {
  return isNewThreadProjectDraftKey(storageKey)
    ? `bb.promptbox.${kind}-new-thread-${newThreadProjectSegment(storageKey)}-`
    : `bb.promptbox.${kind}-draft-`;
}

function backUpDiscardedDraft(
  storageKey: string,
  rawValue: string,
  kind: "unreadable" | "discarded",
): boolean {
  let backupKey: string;
  do {
    backupKey = `${discardBackupPrefix(storageKey, kind)}${createDraftRev()}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  } while (readStoredPromptDraftValue(backupKey) !== null);
  try {
    window.localStorage.setItem(backupKey, rawValue);
  } catch (error) {
    console.warn(`[prompt-draft] could not back up ${storageKey}`, error);
    return false;
  }
  return readStoredPromptDraftValue(backupKey) === rawValue;
}

function withDraftWriteLock<T>(storageKey: string, run: () => T): Promise<T> {
  const locks = webLocks();
  if (!locks) return Promise.resolve(run());
  let started = false;
  return locks
    .request(
      `bb.promptbox.write.${storageKey}`,
      { signal: AbortSignal.timeout(PROMPT_DRAFT_LOCK_TIMEOUT_MS) },
      () => {
        started = true;
        return run();
      },
    )
    .catch((error: unknown) => {
      if (started) throw error;
      return run();
    });
}

export function discardNewThreadDraft(
  storageKey: string,
  confirmedDraft?: PromptDraftState,
): Promise<"discarded" | "changed" | "failed" | "nothing-to-discard"> {
  return withDraftWriteLock(storageKey, () => discardNewThreadDraftNow(storageKey, confirmedDraft));
}

function discardNewThreadDraftNow(
  storageKey: string,
  confirmedDraft?: PromptDraftState,
): "discarded" | "changed" | "failed" | "nothing-to-discard" {
  const rawValue = readStoredPromptDraftValue(storageKey);
  if (rawValue === null) return "nothing-to-discard";
  const record = readNewThreadRecord(rawValue);
  if (
    record.kind === "draft" &&
    confirmedDraft &&
    !arePromptDraftStatesEqual(record.draft, confirmedDraft)
  ) {
    return "changed";
  }
  if (
    (record.kind === "unreadable" || record.kind === "draft") &&
    (!backUpDiscardedDraft(storageKey, rawValue, record.kind === "draft" ? "discarded" : "unreadable") ||
      readStoredPromptDraftValue(storageKey) !== rawValue)
  ) {
    return "failed";
  }
  const tombstone = JSON.stringify({ rev: createDraftRev(), discarded: true });
  if (!writeTerminalRecord(storageKey, tombstone, "rev" in record ? record.rev : undefined)) {
    return "failed";
  }
  const heldEntry = promptDraftCache.get(storageKey);
  const heldBecauseUnreadable = newThreadDraftNotices.get(storageKey) === "unreadable";
  unsavedPromptDraftKeys.delete(storageKey);
  newThreadDraftNotices.delete(storageKey);
  if (heldBecauseUnreadable && heldEntry && !isPromptDraftEmpty(heldEntry.draft)) {
    newThreadDraftRevs.set(storageKey, String(readStoredRev(tombstone)));
    persistPromptDraftCache(storageKey);
  } else {
    promptDraftCache.delete(storageKey);
  }
  emitPromptDraftChange(storageKey);
  return "discarded";
}

export interface NewThreadDraftNotShown {
  kind: "legacy" | "unreadable" | "conflict" | "unlisted-project";
  key: string;
  projectId: string | null;
  draft?: PromptDraftState;
  alreadyMoved?: boolean;
}

const LEGACY_NEW_THREAD_DRAFT_KEY = `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
const LEGACY_MOVED_TEXT_KEY = "bb.promptbox.legacy-moved-3";

function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function movedLegacyTextHashes(): string[] {
  try {
    const parsed: unknown = JSON.parse(readStoredPromptDraftValue(LEGACY_MOVED_TEXT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberMovedLegacyText(text: string): void {
  const hashes = new Set(movedLegacyTextHashes());
  hashes.add(textHash(text));
  try {
    window.localStorage.setItem(LEGACY_MOVED_TEXT_KEY, JSON.stringify([...hashes]));
  } catch (error) {
    console.warn("[prompt-draft] could not remember moved legacy text", error);
  }
}

function parseNewThreadSideKey(key: string, prefix: string): string | null {
  const match = new RegExp(`^${prefix.replaceAll(".", "\\.")}([^-]+)-[0-9a-f]{16}-3$`).exec(key);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function listNewThreadDraftsNotShown(
  knownProjectIds: readonly string[],
): NewThreadDraftNotShown[] {
  if (typeof window === "undefined") return [];
  const rows: NewThreadDraftNotShown[] = [];
  const known = new Set([...knownProjectIds, "proj_personal"]);
  try {
    collectNewThreadDraftsNotShown(rows, known);
  } catch (error) {
    console.warn("[prompt-draft] could not read saved drafts", error);
  }
  collectNewThreadDraftsInMemory(rows, known);
  return rows;
}

function collectNewThreadDraftsNotShown(
  rows: NewThreadDraftNotShown[],
  known: ReadonlySet<string>,
): void {
  const legacy = readNewThreadRecord(readStoredPromptDraftValue(LEGACY_NEW_THREAD_DRAFT_KEY));
  if (legacy.kind === "unreadable") {
    rows.push({ kind: "unreadable", key: LEGACY_NEW_THREAD_DRAFT_KEY, projectId: null });
  } else if (legacy.kind === "draft" && !isPromptDraftEmpty(legacy.draft)) {
    rows.push({
      kind: "legacy",
      key: LEGACY_NEW_THREAD_DRAFT_KEY,
      projectId: null,
      draft: legacy.draft,
      ...(movedLegacyTextHashes().includes(textHash(legacy.draft.text)) ? { alreadyMoved: true } : {}),
    });
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    const record = readNewThreadRecord(readStoredPromptDraftValue(key));
    if (isNewThreadProjectDraftKey(key)) {
      const projectId = decodeURIComponent(newThreadProjectSegment(key));
      if (record.kind === "unreadable") {
        rows.push({ kind: "unreadable", key, projectId });
      } else if (
        record.kind === "draft" &&
        !isPromptDraftEmpty(record.draft) &&
        !known.has(projectId)
      ) {
        rows.push({ kind: "unlisted-project", key, projectId, draft: record.draft });
      }
      continue;
    }
    if (record.kind !== "draft" || isPromptDraftEmpty(record.draft)) continue;
    const conflictProject = parseNewThreadSideKey(key, "bb.promptbox.conflict-new-thread-");
    if (conflictProject) {
      rows.push({ kind: "conflict", key, projectId: conflictProject, draft: record.draft });
      continue;
    }
    const recoveryProject = parseNewThreadSideKey(key, "bb.promptbox.recovery-new-thread-");
    if (!recoveryProject) continue;
    const storedRev = readStoredRev(
      readStoredPromptDraftValue(
        getPromptDraftStorageKey({ kind: "new-thread", projectId: recoveryProject }),
      ),
    );
    const base = readStoredBase(readStoredPromptDraftValue(key));
    if (record.rev === storedRev) continue;
    if (base !== storedRev) {
      rows.push({ kind: "conflict", key, projectId: recoveryProject, draft: record.draft });
    } else if (!known.has(recoveryProject)) {
      rows.push({ kind: "unlisted-project", key, projectId: recoveryProject, draft: record.draft });
    }
  }
}

function collectNewThreadDraftsInMemory(
  rows: NewThreadDraftNotShown[],
  known: ReadonlySet<string>,
): void {
  for (const storageKey of new Set([...unsavedPromptDraftKeys, ...pendingPromptDraftStorageKeys])) {
    const draft = promptDraftCache.get(storageKey)?.draft;
    if (!isNewThreadProjectDraftKey(storageKey) || !draft || isPromptDraftEmpty(draft)) continue;
    const projectId = decodeURIComponent(newThreadProjectSegment(storageKey));
    if (known.has(projectId)) continue;
    const storedRow = rows.find((row) => row.key === storageKey);
    if (storedRow) storedRow.draft = draft;
    else rows.push({ kind: "unlisted-project", key: storageKey, projectId, draft });
  }
  const unique = rows.filter(
    (row, index) =>
      !row.draft ||
      !rows
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.projectId === row.projectId &&
            earlier.draft !== undefined &&
            arePromptDraftStatesEqual(earlier.draft, row.draft!),
        ),
  );
  rows.splice(0, rows.length, ...unique);
}

export function getPromptDraftAccessor(scope: PromptDraftScope): {
  storageKey: string;
  getCurrent: () => PromptDraftState;
  subscribe: (listener: () => void) => () => void;
  setDraft: (draft: PromptDraftState) => void;
  addQuote: ThreadTimelineAddToChatHandler;
} {
  const storageKey = getPromptDraftStorageKey(scope);
  return {
    storageKey,
    getCurrent: () => readPromptDraft(storageKey),
    subscribe: (listener) => subscribePromptDraft(storageKey, listener),
    setDraft: (draft) => writePromptDraft(storageKey, draft),
    addQuote: (text, attachments, source) =>
      addQuoteToPromptDraft(storageKey, text, attachments, source),
  };
}

export function usePromptDraftStorage(scope: PromptDraftScope) {
  const storageKey = getPromptDraftStorageKey(scope);
  const draft = useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(() => readPromptDraft(storageKey), [storageKey]),
    () => EMPTY_PROMPT_DRAFT,
  );

  const status = useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(() => readPromptDraftStatus(storageKey), [storageKey]),
    () => "saved",
  );

  useEffect(
    () => () => {
      if (pendingPromptDraftStorageKeys.has(storageKey)) {
        persistPromptDraftCache(storageKey);
      }
    },
    [storageKey],
  );

  const setDraftAndPersist = useCallback(
    (nextDraft: PromptDraftState) => {
      writePromptDraft(storageKey, nextDraft);
    },
    [storageKey],
  );

  const getCurrent = useCallback((): PromptDraftState => {
    return readPromptDraft(storageKey);
  }, [storageKey]);

  const subscribe = useCallback(
    (listener: () => void) => subscribePromptDraft(storageKey, listener),
    [storageKey],
  );

  const setTextAndMentions = useCallback(
    (nextText: string, nextMentions: PromptTextMention[]) => {
      writePromptDraft(
        storageKey,
        {
          ...readPromptDraft(storageKey),
          text: nextText,
          mentions: nextMentions,
        },
        { persist: "deferred" },
      );
    },
    [storageKey],
  );

  const addAttachment = useCallback(
    (attachment: PromptDraftAttachment) => {
      const currentDraft = readPromptDraft(storageKey);
      const alreadyExists = currentDraft.attachments.some(
        (existingAttachment) => existingAttachment.path === attachment.path,
      );
      if (alreadyExists) return;

      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: [...currentDraft.attachments, attachment],
      });
    },
    [storageKey],
  );

  const removeAttachment = useCallback(
    (path: string) => {
      const currentDraft = readPromptDraft(storageKey);
      const nextAttachments = currentDraft.attachments.filter(
        (attachment) => attachment.path !== path,
      );
      if (nextAttachments.length === currentDraft.attachments.length) {
        return;
      }

      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: nextAttachments,
      });
    },
    [storageKey],
  );

  const addQuote = useCallback<ThreadTimelineAddToChatHandler>(
    (text, attachments, source) =>
      addQuoteToPromptDraft(storageKey, text, attachments, source),
    [storageKey],
  );

  const clear = useCallback(() => {
    setDraftAndPersist(EMPTY_PROMPT_DRAFT);
  }, [setDraftAndPersist]);

  const clearIfCurrentMatches = useCallback(
    (expectedDraft: PromptDraftState): boolean => {
      if (
        !arePromptDraftStatesEqual(readPromptDraft(storageKey), expectedDraft)
      ) {
        return false;
      }

      if (isNewThreadProjectDraftKey(storageKey)) {
        const storedValue = readStoredPromptDraftValue(storageKey);
        const storedRev = readStoredRev(storedValue);
        if (
          storedValue !== null &&
          storedRev !== newThreadDraftRevs.get(storageKey) &&
          !arePromptDraftStatesEqual(parsePromptDraftStorage(storedValue), expectedDraft)
        ) {
          return false;
        }
        clearPromptDraftPersistTimer(storageKey);
        pendingPromptDraftStorageKeys.delete(storageKey);
        return writeNewThreadSentMarker(storageKey, storedRev);
      }
      setDraftAndPersist(EMPTY_PROMPT_DRAFT);
      return true;
    },
    [setDraftAndPersist, storageKey],
  );

  const getRevision = useCallback(() => promptDraftEditRevision(storageKey), [storageKey]);

  const clearAfterSend = useCallback(
    (expectedDraft: PromptDraftState, sentRevision: string): Promise<boolean> => {
      const clearIfUnchanged = () =>
        isUnchangedSinceSend(storageKey, sentRevision) && clearIfCurrentMatches(expectedDraft);
      return isNewThreadProjectDraftKey(storageKey)
        ? withDraftWriteLock(storageKey, clearIfUnchanged)
        : Promise.resolve(clearIfUnchanged());
    },
    [clearIfCurrentMatches, storageKey],
  );

  const setAttachments = useCallback(
    (attachments: PromptDraftAttachment[]) => {
      writePromptDraft(storageKey, {
        ...readPromptDraft(storageKey),
        attachments,
      });
    },
    [storageKey],
  );

  const keepMyCopy = useCallback(() => {
    const storedRev = readStoredRev(readStoredPromptDraftValue(storageKey));
    if (storedRev) newThreadDraftRevs.set(storageKey, storedRev);
    unsavedPromptDraftKeys.delete(storageKey);
    newThreadDraftNotices.delete(storageKey);
    persistPromptDraftCache(storageKey);
    emitPromptDraftChange(storageKey);
  }, [storageKey]);

  const dismissNotice = useCallback(() => {
    newThreadDraftNotices.delete(storageKey);
    emitPromptDraftChange(storageKey);
  }, [storageKey]);

  const restoreIfEmpty = useCallback(
    (nextDraft: PromptDraftState) => {
      restorePromptDraftIfEmpty(storageKey, nextDraft);
    },
    [storageKey],
  );

  return useMemo(
    () => ({
      storageKey,
      getCurrent,
      subscribe,
      isUnsaved: status.startsWith("unsaved"),
      notice: (newThreadDraftNotices.get(storageKey) ?? null) as NewThreadDraftNotice | null,
      value: draft.text,
      text: draft.text,
      mentions: draft.mentions,
      attachments: draft.attachments,
      contexts: draft.contexts,
      setDraft: setDraftAndPersist,
      setTextAndMentions,
      setAttachments,
      addAttachment,
      removeAttachment,
      addQuote,
      clear,
      clearIfCurrentMatches,
      clearAfterSend,
      getRevision,
      restoreIfEmpty,
      keepMyCopy,
      dismissNotice,
    }),
    [
      addAttachment,
      addQuote,
      clear,
      clearAfterSend,
      clearIfCurrentMatches,
      dismissNotice,
      draft.attachments,
      draft.contexts,
      draft.mentions,
      draft.text,
      getCurrent,
      getRevision,
      keepMyCopy,
      removeAttachment,
      restoreIfEmpty,
      setAttachments,
      setDraftAndPersist,
      setTextAndMentions,
      status,
      storageKey,
      subscribe,
    ],
  );
}

export function usePromptDraftHasInput(scope: PromptDraftScope): boolean {
  const storageKey = getPromptDraftStorageKey(scope);

  return useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(
      () => !isPromptDraftEmpty(readPromptDraft(storageKey)),
      [storageKey],
    ),
    () => false,
  );
}

interface PromptDraftThreadRef {
  id: string;
  projectId: string;
}

interface PromptDraftThreadSubscription {
  storageKey: string;
  threadId: string;
}

function getEmptyPresenceSnapshot(): string {
  return "";
}

function readPromptDraftPresenceBit(storageKey: string): "0" | "1" {
  return isPromptDraftEmpty(readPromptDraft(storageKey)) ? "0" : "1";
}

function createPromptDraftPresenceStore(
  subscriptions: readonly PromptDraftThreadSubscription[],
): {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string;
} {
  let bits: ("0" | "1")[] | null = null;
  let snapshot: string | null = null;
  const refresh = (): string => {
    bits = subscriptions.map(({ storageKey }) =>
      readPromptDraftPresenceBit(storageKey),
    );
    snapshot = bits.join("");
    return snapshot;
  };
  return {
    getSnapshot: () => snapshot ?? refresh(),
    subscribe: (listener) => {
      snapshot = null;
      bits = null;
      const unsubscribe = subscriptions.map(({ storageKey }, index) =>
        subscribePromptDraft(storageKey, () => {
          const bit = readPromptDraftPresenceBit(storageKey);
          if (bits !== null && bits[index] === bit) return;
          if (bits === null) {
            refresh();
          } else {
            bits[index] = bit;
            snapshot = bits.join("");
          }
          listener();
        }),
      );
      return () => {
        for (const stopListening of unsubscribe) {
          stopListening();
        }
      };
    },
  };
}

export function usePromptDraftInputThreadIds(
  threads: readonly PromptDraftThreadRef[],
): ReadonlySet<string> {
  const subscriptions = useMemo<PromptDraftThreadSubscription[]>(() => {
    const seenStorageKeys = new Set<string>();
    const next: PromptDraftThreadSubscription[] = [];
    for (const thread of threads) {
      const storageKey = getPromptDraftStorageKey({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      });
      if (!storageKey || seenStorageKeys.has(storageKey)) continue;

      seenStorageKeys.add(storageKey);
      next.push({ storageKey, threadId: thread.id });
    }
    return next;
  }, [threads]);

  const presenceStore = useMemo(
    () => createPromptDraftPresenceStore(subscriptions),
    [subscriptions],
  );
  const presenceSnapshot = useSyncExternalStore(
    presenceStore.subscribe,
    presenceStore.getSnapshot,
    getEmptyPresenceSnapshot,
  );

  return useMemo(() => {
    const threadIds = new Set<string>();
    subscriptions.forEach(({ threadId }, index) => {
      if (presenceSnapshot[index] === "1") {
        threadIds.add(threadId);
      }
    });
    return threadIds;
  }, [presenceSnapshot, subscriptions]);
}
