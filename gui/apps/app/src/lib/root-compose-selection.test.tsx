// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@cloudroom/domain";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import {
  RECENT_PROJECTS_STORAGE_KEY,
  recentProjectsScope,
  useRecentProjectIds,
  useRecordRecentProject,
} from "./root-compose-selection";

const DATA_DIR = "/Users/jake/.bb";
const OTHER_DATA_DIR = "/Users/jake/.bb-dev";
const SCOPE = recentProjectsScope(DATA_DIR) ?? "";
const OTHER_SCOPE = recentProjectsScope(OTHER_DATA_DIR) ?? "";

function setup({
  dataDir = DATA_DIR as string | null,
  store = createStore(),
} = {}) {
  const queryClient = new QueryClient();
  if (dataDir !== null) {
    queryClient.setQueryData(systemConfigQueryKey(), { dataDir } as never);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
  return renderHook(
    () => ({
      record: useRecordRecentProject(),
      ids: useRecentProjectIds(recentProjectsScope(dataDir ?? undefined)),
    }),
    { wrapper },
  );
}

function stored(): Record<string, { id: string; usedAt: number }[]> {
  return JSON.parse(
    window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) ?? "{}",
  ) as Record<string, { id: string; usedAt: number }[]>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recent projects", () => {
  it("orders by deliberate use, newest first, without duplicates", () => {
    const { result } = setup();
    act(() => {
      result.current.record("proj_a");
      result.current.record("proj_b");
      result.current.record("proj_c");
      result.current.record("proj_a");
    });
    expect(result.current.ids).toEqual(["proj_a", "proj_c", "proj_b"]);
  });

  it("keeps insertion order and monotonic times when uses share a timestamp", () => {
    const { result } = setup();
    act(() => {
      result.current.record("proj_a");
      result.current.record("proj_b");
    });
    expect(result.current.ids).toEqual(["proj_b", "proj_a"]);
    const [newest, older] = stored()[SCOPE];
    expect(newest.usedAt).toBeGreaterThanOrEqual(older.usedAt);
  });

  it("never records the no-project workspace or an empty id", () => {
    const { result } = setup();
    act(() => {
      result.current.record(PERSONAL_PROJECT_ID);
      result.current.record("");
    });
    expect(result.current.ids).toEqual([]);
    expect(window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY)).toBeNull();
  });

  it("does not record before the server identity is known", () => {
    const { result } = setup({ dataDir: null });
    act(() => result.current.record("proj_a"));
    expect(window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY)).toBeNull();
  });

  it("scopes history to the server so another server's projects never show", () => {
    const first = setup();
    act(() => first.result.current.record("proj_a"));
    first.unmount();

    const second = setup({ dataDir: OTHER_DATA_DIR });
    expect(second.result.current.ids).toEqual([]);
    act(() => second.result.current.record("proj_other"));
    expect(second.result.current.ids).toEqual(["proj_other"]);
    expect(stored()[SCOPE].map((entry) => entry.id)).toEqual(["proj_a"]);
    expect(SCOPE).not.toBe(OTHER_SCOPE);
    expect(JSON.stringify(stored())).not.toContain(DATA_DIR);
  });

  it("survives a restart from local storage", () => {
    const first = setup();
    act(() => {
      first.result.current.record("proj_a");
      first.result.current.record("proj_b");
    });
    first.unmount();

    const restarted = setup({ store: createStore() });
    expect(restarted.result.current.ids).toEqual(["proj_b", "proj_a"]);
  });

  it("merges with a use recorded by another tab instead of overwriting it", () => {
    const { result } = setup();
    act(() => result.current.record("proj_a"));
    window.localStorage.setItem(
      RECENT_PROJECTS_STORAGE_KEY,
      JSON.stringify({
        [SCOPE]: [
          { id: "proj_other_tab", usedAt: 1_000_000 },
          { id: "proj_a", usedAt: 1_000_000 },
        ],
      }),
    );
    act(() => result.current.record("proj_c"));
    expect(result.current.ids).toEqual(["proj_c", "proj_other_tab", "proj_a"]);
  });

  it("follows another tab's update through the storage event", () => {
    const { result } = setup();
    const newValue = JSON.stringify({
      [SCOPE]: [{ id: "proj_from_tab", usedAt: 5 }],
    });
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, newValue);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: RECENT_PROJECTS_STORAGE_KEY,
          newValue,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.ids).toEqual(["proj_from_tab"]);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an array", "[]"],
    ["a scalar", "42"],
  ])("ignores %s in storage and recovers on the next use", (_label, raw) => {
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, raw);
    const { result } = setup();
    expect(result.current.ids).toEqual([]);
    act(() => result.current.record("proj_a"));
    expect(result.current.ids).toEqual(["proj_a"]);
  });

  it("drops malformed entries and unknown scopes but keeps valid ones", () => {
    window.localStorage.setItem(
      RECENT_PROJECTS_STORAGE_KEY,
      `{"__proto__":[{"id":"proj_polluted","usedAt":9}],${JSON.stringify({
        [SCOPE]: [
          { id: "proj_ok", usedAt: 3 },
          { id: 7, usedAt: 2 },
          { id: "proj_no_time" },
          { id: PERSONAL_PROJECT_ID, usedAt: 2 },
          { id: "proj_ok", usedAt: 1 },
          null,
          { id: "proj_second", usedAt: 1 },
        ],
        "not-a-scope": [{ id: "proj_x", usedAt: 9 }],
      }).slice(1)}`,
    );
    const { result } = setup();
    expect(result.current.ids).toEqual(["proj_ok", "proj_second"]);
    act(() => result.current.record("proj_new"));
    expect(Object.keys(stored())).toEqual([SCOPE]);
    expect(result.current.ids).not.toContain("proj_polluted");
    expect(JSON.stringify(stored())).not.toContain("proj_polluted");
  });

  it("caps stored history so deleted projects can be skipped without losing five", () => {
    const { result } = setup();
    act(() => {
      for (let index = 0; index < 30; index += 1) {
        result.current.record(`proj_${index}`);
      }
    });
    expect(result.current.ids).toHaveLength(20);
    expect(result.current.ids[0]).toBe("proj_29");
  });

  it("keeps the ten most recently used servers", () => {
    window.localStorage.setItem(
      RECENT_PROJECTS_STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [
            `server-old${index}`,
            [{ id: `proj_${index}`, usedAt: index }],
          ]),
        ),
      ),
    );
    const { result } = setup();
    act(() => result.current.record("proj_now"));
    const scopes = Object.keys(stored());
    expect(scopes).toHaveLength(10);
    expect(scopes[0]).toBe(SCOPE);
    expect(scopes).toContain("server-old11");
    expect(scopes).not.toContain("server-old0");
  });

  it("keeps working for the session when local storage rejects writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const { result } = setup();
    act(() => {
      result.current.record("proj_a");
      result.current.record("proj_b");
    });
    expect(result.current.ids).toEqual(["proj_b", "proj_a"]);
    expect(window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY)).toBeNull();
  });
});
