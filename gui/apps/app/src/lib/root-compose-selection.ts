import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@cloudroom/domain";
import { systemConfigQueryOptions } from "@/hooks/queries/system-queries";
import {
  createLocalStorageSyncStorage,
  createTabScopedStorage,
  withLocalStorage,
} from "./browser-storage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";
export const RECENT_PROJECTS_STORAGE_KEY = "bb.root-compose.recent-projects.v1";
const MAX_RECENT_PROJECTS_PER_SCOPE = 20;
const MAX_RECENT_PROJECT_SCOPES = 10;
const RECENT_PROJECTS_SCOPE_PATTERN = /^server-[0-9a-z]+$/;

interface RecentProject {
  id: string;
  usedAt: number;
}

type RecentProjectsByScope = Readonly<Record<string, readonly RecentProject[]>>;

const NO_RECENT_PROJECTS: readonly RecentProject[] = [];
const NO_RECENT_PROJECT_IDS: readonly string[] = [];
const EMPTY_RECENT_PROJECTS: RecentProjectsByScope = {};

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string,
): string {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

const rootComposeProjectIdStorage = createTabScopedStorage<string>(
  {
    parse: parseStoredProjectId,
    serialize: (value) => value,
  },
  { persistInitialValue: true },
);

const rootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const rootComposeReuseEnvironmentAtom = atom<string | null>(null);

export function useRootComposeProjectId() {
  return useAtom(rootComposeProjectIdAtom);
}

export function useSetRootComposeProjectId() {
  return useSetAtom(rootComposeProjectIdAtom);
}

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtom);
}

export function recentProjectsScope(
  dataDir: string | undefined,
): string | null {
  if (!dataDir) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < dataDir.length; index += 1) {
    hash = Math.imul(hash ^ dataDir.charCodeAt(index), 0x01000193);
  }
  return `server-${(hash >>> 0).toString(36)}`;
}

function parseRecentProjects(
  storedValue: string | null,
  initialValue: RecentProjectsByScope,
): RecentProjectsByScope {
  if (storedValue === null) return initialValue;
  let parsed: unknown;
  try {
    parsed = JSON.parse(storedValue);
  } catch {
    return initialValue;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return initialValue;
  }
  const byScope: Record<string, RecentProject[]> = {};
  for (const [scope, entries] of Object.entries(parsed)) {
    if (!RECENT_PROJECTS_SCOPE_PATTERN.test(scope) || !Array.isArray(entries)) {
      continue;
    }
    const seen = new Set<string>();
    const valid: RecentProject[] = [];
    for (const entry of entries as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, usedAt } = entry as Record<string, unknown>;
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id === PERSONAL_PROJECT_ID ||
        seen.has(id) ||
        typeof usedAt !== "number" ||
        !Number.isFinite(usedAt)
      ) {
        continue;
      }
      seen.add(id);
      valid.push({ id, usedAt });
    }
    if (valid.length > 0) {
      byScope[scope] = valid.slice(0, MAX_RECENT_PROJECTS_PER_SCOPE);
    }
  }
  return byScope;
}

const recentProjectsStorage =
  createLocalStorageSyncStorage<RecentProjectsByScope>({
    parse: parseRecentProjects,
    serialize: (value) => JSON.stringify(value),
  });

const recentProjectsAtom = atomWithStorage<RecentProjectsByScope>(
  RECENT_PROJECTS_STORAGE_KEY,
  EMPTY_RECENT_PROJECTS,
  recentProjectsStorage,
  { getOnInit: true },
);

export function addRecentProject(
  current: RecentProjectsByScope,
  scope: string,
  projectId: string,
  now: number,
): RecentProjectsByScope {
  const previous = current[scope] ?? NO_RECENT_PROJECTS;
  const usedAt = Math.max(now, previous[0]?.usedAt ?? 0);
  const entries = [
    { id: projectId, usedAt },
    ...previous.filter((entry) => entry.id !== projectId),
  ].slice(0, MAX_RECENT_PROJECTS_PER_SCOPE);
  const otherScopes = Object.entries(current)
    .filter(([key]) => key !== scope)
    .sort(([, a], [, b]) => (b[0]?.usedAt ?? 0) - (a[0]?.usedAt ?? 0))
    .slice(0, MAX_RECENT_PROJECT_SCOPES - 1);
  return Object.fromEntries([[scope, entries], ...otherScopes]);
}

export function useRecentProjectIds(scope: string | null): readonly string[] {
  const byScope = useAtomValue(recentProjectsAtom);
  const entries = scope === null ? undefined : byScope[scope];
  return useMemo(
    () => entries?.map((entry) => entry.id) ?? NO_RECENT_PROJECT_IDS,
    [entries],
  );
}

export function useRecordRecentProject(): (projectId: string) => void {
  const queryClient = useQueryClient();
  const setRecentProjects = useSetAtom(recentProjectsAtom);
  return useCallback(
    (projectId: string) => {
      if (projectId.length === 0 || projectId === PERSONAL_PROJECT_ID) return;
      const scope = recentProjectsScope(
        queryClient.getQueryData(systemConfigQueryOptions().queryKey)?.dataDir,
      );
      if (scope === null) return;
      const latest = parseRecentProjects(
        withLocalStorage(
          (storage) => storage.getItem(RECENT_PROJECTS_STORAGE_KEY),
          null,
        ),
        EMPTY_RECENT_PROJECTS,
      );
      setRecentProjects(addRecentProject(latest, scope, projectId, Date.now()));
    },
    [queryClient, setRecentProjects],
  );
}
