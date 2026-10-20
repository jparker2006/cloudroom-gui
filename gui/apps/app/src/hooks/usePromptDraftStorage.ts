import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { PromptTextMention } from "@cloudroom/domain";
import type { PromptDraftAttachment, PromptDraftState } from "@cloudroom/client-core";
import type {
  ThreadTimelineAddToChatHandler,
  ThreadTimelineAddToChatSource,
} from "@/components/thread/timeline/types";
import {
  appendMessageContextToDraft,
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

function newThreadConflictKey(storageKey: string, rev: string): string {
  const projectSegment = storageKey.slice(
    NEW_THREAD_DRAFT_KEY_PREFIX.length,
    -`-${PROMPT_DRAFT_STORAGE_VERSION}`.length,
  );
  return `bb.promptbox.conflict-new-thread-${projectSegment}-${rev}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

function reconcileWithStoredNewThreadDraft(
  storageKey: string,
  cachedEntry: PromptDraftCacheEntry,
): boolean {
  const rawValue = readStoredPromptDraftValue(storageKey);
  const storedRev = readStoredRev(rawValue);
  if (rawValue === null || !storedRev || storedRev === newThreadDraftRevs.get(storageKey)) {
    return true;
  }

  const storedDraft = parsePromptDraftStorage(rawValue);
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
      isUnsaved: unsavedPromptDraftKeys.has(storageKey),
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
