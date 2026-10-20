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

  const rawValue = window.localStorage.getItem(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (cachedEntry && cachedEntry.rawValue === rawValue) {
    return cachedEntry.draft;
  }

  const draft = parsePromptDraftStorage(rawValue);
  if (isNewThreadProjectDraftKey(storageKey)) {
    const rev = readStoredRev(rawValue);
    if (rev) newThreadDraftRevs.set(storageKey, rev);
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
    listener();
  }
}

function clearPromptDraftPersistTimer(storageKey: string): void {
  const timerId = promptDraftPersistTimers.get(storageKey);
  if (timerId === undefined || typeof window === "undefined") return;

  window.clearTimeout(timerId);
  promptDraftPersistTimers.delete(storageKey);
}

function persistPromptDraftCache(storageKey: string): void {
  if (typeof window === "undefined") return;

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
  } catch (error) {
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
  if (record.kind === "moved" || record.kind === "discarded") {
    return holdInMemory(storageKey, cachedEntry, rawValue, "moved-elsewhere");
  }
  if (record.kind === "missing") return true;
  const storedRev = record.rev;
  if (storedRev) removeRecoveryCopiesWithRev(storageKey, storedRev);
  if (!storedRev || storedRev === newThreadDraftRevs.get(storageKey)) {
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

function writeNewThreadSentMarker(storageKey: string): void {
  const marker = withDraftRev(storageKey, JSON.stringify({ sent: true }));
  promptDraftCache.set(storageKey, { rawValue: marker, draft: EMPTY_PROMPT_DRAFT });
  try {
    window.localStorage.setItem(storageKey, marker);
    unsavedPromptDraftKeys.delete(storageKey);
  } catch (error) {
    unsavedPromptDraftKeys.add(storageKey);
    console.warn(`[prompt-draft] could not mark ${storageKey} as sent`, error);
  }
  emitPromptDraftChange(storageKey);
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
    persistPromptDraftCache(storageKey);
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

export function moveNewThreadDraft(
  sourceKey: string,
  targetProjectId: string,
): MoveNewThreadDraftResult {
  const targetKey = getPromptDraftStorageKey({ kind: "new-thread", projectId: targetProjectId });
  if (pendingPromptDraftStorageKeys.has(targetKey)) persistPromptDraftCache(targetKey);

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
  writePromptDraft(
    targetKey,
    appendPromptDraft(previousTarget, { ...source.draft, attachments: carried }),
  );
  if (unsavedPromptDraftKeys.has(targetKey)) {
    promptDraftCache.set(targetKey, {
      rawValue: readStoredPromptDraftValue(targetKey),
      draft: previousTarget,
    });
    unsavedPromptDraftKeys.delete(targetKey);
    emitPromptDraftChange(targetKey);
    return { status: "failed" };
  }

  const rev = createDraftRev();
  const sourceValue =
    leftovers.length > 0
      ? JSON.stringify({ text: "", attachments: leftovers, rev })
      : JSON.stringify({ rev, moved: true });
  try {
    window.localStorage.setItem(sourceKey, sourceValue);
  } catch (error) {
    console.warn(`[prompt-draft] moved ${sourceKey} but could not update it`, error);
    return { status: "source-not-updated" };
  }
  promptDraftCache.delete(sourceKey);
  emitPromptDraftChange(sourceKey);
  return { status: "moved", leftoverAttachments: leftovers.map((attachment) => attachment.name) };
}

function unreadableBackupPrefix(storageKey: string): string {
  return isNewThreadProjectDraftKey(storageKey)
    ? `bb.promptbox.unreadable-new-thread-${newThreadProjectSegment(storageKey)}-`
    : "bb.promptbox.unreadable-draft-";
}

function backUpUnreadableDraft(storageKey: string, rawValue: string): boolean {
  let backupKey: string;
  do {
    backupKey = `${unreadableBackupPrefix(storageKey)}${createDraftRev()}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  } while (readStoredPromptDraftValue(backupKey) !== null);
  try {
    window.localStorage.setItem(backupKey, rawValue);
  } catch (error) {
    console.warn(`[prompt-draft] could not back up ${storageKey}`, error);
    return false;
  }
  return readStoredPromptDraftValue(backupKey) === rawValue;
}

export function discardNewThreadDraft(
  storageKey: string,
): "discarded" | "failed" | "nothing-to-discard" {
  const rawValue = readStoredPromptDraftValue(storageKey);
  if (rawValue === null) return "nothing-to-discard";
  if (
    readNewThreadRecord(rawValue).kind === "unreadable" &&
    (!backUpUnreadableDraft(storageKey, rawValue) ||
      readStoredPromptDraftValue(storageKey) !== rawValue)
  ) {
    return "failed";
  }
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ rev: createDraftRev(), discarded: true }),
    );
  } catch (error) {
    console.warn(`[prompt-draft] could not discard ${storageKey}`, error);
    return "failed";
  }
  promptDraftCache.delete(storageKey);
  emitPromptDraftChange(storageKey);
  return "discarded";
}

export interface NewThreadDraftNotShown {
  kind: "legacy" | "unreadable" | "conflict" | "unlisted-project";
  key: string;
  projectId: string | null;
  draft?: PromptDraftState;
}

const LEGACY_NEW_THREAD_DRAFT_KEY = `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;

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
  const legacy = readNewThreadRecord(readStoredPromptDraftValue(LEGACY_NEW_THREAD_DRAFT_KEY));
  if (legacy.kind === "unreadable") {
    rows.push({ kind: "unreadable", key: LEGACY_NEW_THREAD_DRAFT_KEY, projectId: null });
  } else if (legacy.kind === "draft" && !isPromptDraftEmpty(legacy.draft)) {
    rows.push({ kind: "legacy", key: LEGACY_NEW_THREAD_DRAFT_KEY, projectId: null, draft: legacy.draft });
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
    if (record.rev !== storedRev && base !== storedRev) {
      rows.push({ kind: "conflict", key, projectId: recoveryProject, draft: record.draft });
    }
  }
  return rows;
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
        writeNewThreadSentMarker(storageKey);
        return true;
      }
      setDraftAndPersist(EMPTY_PROMPT_DRAFT);
      return true;
    },
    [setDraftAndPersist, storageKey],
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
      restoreIfEmpty,
    }),
    [
      addAttachment,
      addQuote,
      clear,
      clearIfCurrentMatches,
      draft.attachments,
      draft.contexts,
      draft.mentions,
      draft.text,
      getCurrent,
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
