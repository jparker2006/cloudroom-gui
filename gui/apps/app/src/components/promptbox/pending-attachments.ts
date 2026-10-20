import { useCallback, useMemo, useRef, useState } from "react";

export type PendingAttachmentStatus = "queued" | "uploading" | "failed";

export interface PendingAttachment {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
  status: PendingAttachmentStatus;
  error?: string;
}

interface PendingAttachmentEntry extends PendingAttachment {
  targetKey: string;
}

export interface PendingAttachmentTracker {
  pending: readonly PendingAttachment[];
  queue: (targetKey: string, files: readonly File[]) => string[];
  start: (id: string) => boolean;
  settle: (id: string) => boolean;
  fail: (id: string, error: string) => boolean;
  dismiss: (id: string) => void;
}

let nextPendingAttachmentId = 0;

export function usePendingAttachments(
  targetKey: string | null,
): PendingAttachmentTracker {
  const [entries, setEntries] = useState<readonly PendingAttachmentEntry[]>([]);
  const entriesRef = useRef(entries);
  const detachedIdsRef = useRef(new Set<string>());

  const commit = useCallback(
    (
      update: (
        current: readonly PendingAttachmentEntry[],
      ) => readonly PendingAttachmentEntry[],
    ) => {
      entriesRef.current = update(entriesRef.current);
      setEntries(entriesRef.current);
    },
    [],
  );

  const setStatus = useCallback(
    (id: string, status: PendingAttachmentStatus, error?: string) => {
      commit((current) =>
        current.map((entry) =>
          entry.id === id
            ? { ...entry, status, ...(error === undefined ? {} : { error }) }
            : entry,
        ),
      );
    },
    [commit],
  );

  const queue = useCallback(
    (key: string, files: readonly File[]) => {
      const queued = files.map((file): PendingAttachmentEntry => ({
        id: `pending-attachment-${++nextPendingAttachmentId}`,
        name: file.name,
        ...(file.type ? { mimeType: file.type } : {}),
        sizeBytes: file.size,
        status: "queued",
        targetKey: key,
      }));
      commit((current) => [
        ...current.filter(
          (entry) => entry.targetKey !== key || entry.status !== "failed",
        ),
        ...queued,
      ]);
      return queued.map((entry) => entry.id);
    },
    [commit],
  );

  const start = useCallback(
    (id: string) => {
      if (detachedIdsRef.current.delete(id)) return false;
      setStatus(id, "uploading");
      return true;
    },
    [setStatus],
  );

  const settle = useCallback(
    (id: string) => {
      const wasDetached = detachedIdsRef.current.delete(id);
      commit((current) => current.filter((entry) => entry.id !== id));
      return !wasDetached;
    },
    [commit],
  );

  const fail = useCallback(
    (id: string, error: string) => {
      if (detachedIdsRef.current.delete(id)) return false;
      setStatus(id, "failed", error);
      return true;
    },
    [setStatus],
  );

  const dismiss = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id);
      if (!entry) return;
      if (entry.status !== "failed") detachedIdsRef.current.add(id);
      commit((current) => current.filter((candidate) => candidate.id !== id));
    },
    [commit],
  );

  const pending = useMemo(
    () =>
      entries
        .filter((entry) => entry.targetKey === targetKey)
        .map(({ targetKey: _targetKey, ...entry }) => entry),
    [entries, targetKey],
  );

  return { pending, queue, start, settle, fail, dismiss };
}
