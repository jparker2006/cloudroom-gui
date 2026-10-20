// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPromptDraftAccessor,
  usePromptDraftInputThreadIds,
  usePromptDraftStorage,
} from "./usePromptDraftStorage";

const NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-draft-3";
const LEGACY_PROJECT_DRAFT_KEY = "bb.promptbox.contents-proj_prompt-draft-3";

function storedDraft(text: string): string {
  return JSON.stringify({ text, attachments: [] });
}

let scopeCounter = 0;
function uniqueScope() {
  scopeCounter += 1;
  return {
    kind: "thread" as const,
    projectId: `proj-quote-test-${scopeCounter}`,
    threadId: "thr-1",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePromptDraftStorage", () => {
  it("keeps deferred text writes readable and serializes at the persist boundary", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("large pending draft", []);
    });

    expect(result.current.text).toBe("large pending draft");
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    act(() => vi.advanceTimersByTime(249));
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("large pending draft"),
    );
  });

  it("lets an immediate write replace a pending deferred write", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("stale pending draft", []);
      result.current.setDraft({
        text: "immediate replacement",
        mentions: [],
        attachments: [],
      });
    });

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("immediate replacement"),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("immediate replacement"),
    );
  });

  it("keeps the in-memory draft when localStorage rejects the write", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));
    act(() => {
      result.current.setDraft({ text: "small", mentions: [], attachments: [] });
    });
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("small"),
    );

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => {
        result.current.setDraft({
          text: "too large for storage",
          mentions: [],
          attachments: [],
        });
      });
    } finally {
      setItem.mockRestore();
    }

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("small"),
    );
    expect(result.current.text).toBe("too large for storage");
    expect(result.current.getCurrent().text).toBe("too large for storage");
    expect(getPromptDraftAccessor(scope).getCurrent().text).toBe(
      "too large for storage",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("flushes a deferred write when the page is hidden", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("flush before leaving", []);
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("flush before leaving"),
    );
  });

  it("subscribes to draft presence for a batch of threads", () => {
    const projectId = "proj-batch-drafts";
    const threadRefs = [
      { id: "thr-batch-a", projectId },
      { id: "thr-batch-b", projectId },
    ];
    const { result } = renderHook(() => ({
      draft: usePromptDraftStorage({
        kind: "thread",
        projectId,
        threadId: "thr-batch-b",
      }),
      inputThreadIds: usePromptDraftInputThreadIds(threadRefs),
    }));

    expect([...result.current.inputThreadIds]).toEqual([]);

    act(() => {
      result.current.draft.setDraft({
        text: "Unsubmitted",
        mentions: [],
        attachments: [],
      });
    });

    expect([...result.current.inputThreadIds]).toEqual(["thr-batch-b"]);

    act(() => result.current.draft.clear());
    expect([...result.current.inputThreadIds]).toEqual([]);
  });

  it("does not re-read storage or re-render the batch when a draft edit keeps presence", () => {
    const projectId = "proj-batch-keystrokes";
    const threadRefs = Array.from({ length: 30 }, (_, index) => ({
      id: `thr-batch-${index}`,
      projectId,
    }));
    const composer = getPromptDraftAccessor({
      kind: "thread",
      projectId,
      threadId: "thr-batch-3",
    });
    let batchRenders = 0;
    const { result, rerender } = renderHook(() => {
      batchRenders += 1;
      return usePromptDraftInputThreadIds(threadRefs);
    });
    act(() => {
      composer.setDraft({ text: "first", mentions: [], attachments: [] });
    });
    expect([...result.current]).toEqual(["thr-batch-3"]);

    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const presenceReads = () =>
      getItem.mock.calls.filter(([key]) => String(key).includes(projectId))
        .length;
    rerender();
    expect(presenceReads()).toBe(0);

    const rendersBefore = batchRenders;
    act(() => {
      composer.setDraft({
        text: "first keystroke",
        mentions: [],
        attachments: [],
      });
    });
    expect(presenceReads()).toBeLessThanOrEqual(1);
    expect(batchRenders).toBe(rendersBefore);

    act(() => {
      composer.setDraft({ text: "", mentions: [], attachments: [] });
    });
    expect([...result.current]).toEqual([]);
    expect(batchRenders).toBe(rendersBefore + 1);
    getItem.mockRestore();
  });

  it("uses project-agnostic storage for new-thread prompt contents", () => {
    window.localStorage.setItem(
      LEGACY_PROJECT_DRAFT_KEY,
      storedDraft("project draft"),
    );
    window.localStorage.setItem(
      NEW_THREAD_DRAFT_KEY,
      storedDraft("global draft"),
    );

    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread" }),
    );

    expect(result.current.storageKey).toBe(NEW_THREAD_DRAFT_KEY);
    expect(result.current.text).toBe("global draft");

    act(() => {
      result.current.setDraft({
        text: "updated global draft",
        mentions: [],
        attachments: [],
      });
    });

    expect(window.localStorage.getItem(NEW_THREAD_DRAFT_KEY)).toBe(
      storedDraft("updated global draft"),
    );
    expect(window.localStorage.getItem(LEGACY_PROJECT_DRAFT_KEY)).toBe(
      storedDraft("project draft"),
    );
  });

  it("keeps thread follow-up drafts scoped to the thread", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "thread",
        projectId: "proj_prompt",
        threadId: "thr_followup",
      }),
    );

    expect(result.current.storageKey).toBe(
      "bb.promptbox.contents-proj_prompt-thr_followup-3",
    );
  });

  it("keeps automation edit drafts scoped to the automation", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "automation-edit",
        automationId: "auto_watchdog",
      }),
    );

    expect(result.current.storageKey).toBe(
      "bb.promptbox.contents-automation-edit-auto_watchdog-3",
    );
  });
});

describe("usePromptDraftStorage addQuote", () => {
  it("keeps an imperative draft-action consumer unsubscribed from composer writes", () => {
    const scope = uniqueScope();
    let consumerRenders = 0;
    let draftActions: ReturnType<typeof getPromptDraftAccessor> | undefined;

    function DraftActionConsumer() {
      consumerRenders += 1;
      draftActions = getPromptDraftAccessor(scope);
      return null;
    }

    render(<DraftActionConsumer />);
    const rendersBeforeTyping = consumerRenders;
    const composer = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      composer.result.current.setTextAndMentions("typed reply", []);
    });

    expect(consumerRenders).toBe(rendersBeforeTyping);
    expect(draftActions?.storageKey).toBe(composer.result.current.storageKey);

    act(() => {
      draftActions?.addQuote("selected text");
    });

    expect(composer.result.current.text).toBe("typed reply\n> selected text\n");
    expect(consumerRenders).toBe(rendersBeforeTyping);
  });

  it("appends a trimmed quote as a '> ' block to the draft text and persists", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("  ship it  "));

    expect(result.current.text).toBe("> ship it\n");
    expect(window.localStorage.length).toBe(1);
    expect(
      window.localStorage.getItem(result.current.storageKey ?? ""),
    ).toContain("> ship it");
  });

  it("stacks a second quote below the first, separated by a blank line", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("first"));
    act(() => result.current.addQuote("second"));

    expect(result.current.text).toBe("> first\n\n> second\n");
  });

  it("prefixes every line of a multi-line selection", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("line a\nline b"));

    expect(result.current.text).toBe("> line a\n> line b\n");
  });

  it("adds quote attachments to the draft and persists them", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() =>
      result.current.addQuote("review this", [
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 0,
        },
      ]),
    );

    expect(result.current.text).toBe("> review this\n");
    expect(result.current.attachments).toEqual([
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 0,
      },
    ]);
    expect(
      window.localStorage.getItem(result.current.storageKey ?? ""),
    ).toContain("uploads/spec.md");
  });

  it("ignores whitespace-only text without writing", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("   \n  "));

    expect(result.current.text).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  it("syncs an added quote live across two instances of the same scope", () => {
    const scope = uniqueScope();
    const first = renderHook(() => usePromptDraftStorage(scope));
    const second = renderHook(() => usePromptDraftStorage(scope));

    act(() => first.result.current.addQuote("shared selection"));

    expect(second.result.current.text).toBe("> shared selection\n");
  });
});

describe("project-scoped new-thread drafts", () => {
  it("keeps each project's draft separate and leaves the legacy draft untouched", () => {
    window.localStorage.setItem(NEW_THREAD_DRAFT_KEY, storedDraft("legacy text"));
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_alpha" });
    const personal = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_personal" });

    alpha.setDraft({ text: "alpha text", mentions: [], attachments: [] });
    personal.setDraft({ text: "no project text", mentions: [], attachments: [] });

    expect(alpha.getCurrent().text).toBe("alpha text");
    expect(personal.getCurrent().text).toBe("no project text");
    expect(getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_beta" }).getCurrent().text).toBe("");
    expect(window.localStorage.getItem(NEW_THREAD_DRAFT_KEY)).toBe(storedDraft("legacy text"));
    expect(window.localStorage.getItem("bb.promptbox.contents-new-thread-proj_alpha-3")).toContain("alpha text");
  });
});

describe("switching projects in the new-thread composer", () => {
  it("saves the origin draft at the switch and shows the destination draft", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      "bb.promptbox.contents-new-thread-proj_beta-3",
      storedDraft("beta text"),
    );
    const { result, rerender } = renderHook(
      ({ projectId }) => usePromptDraftStorage({ kind: "new-thread", projectId }),
      { initialProps: { projectId: "proj_alpha" } },
    );

    act(() => result.current.setTextAndMentions("alpha typed", []));
    rerender({ projectId: "proj_beta" });

    expect(result.current.text).toBe("beta text");
    expect(window.localStorage.getItem("bb.promptbox.contents-new-thread-proj_alpha-3")).toContain(
      '"text":"alpha typed"',
    );
  });
});

const ALPHA_KEY = "bb.promptbox.contents-new-thread-proj_alpha-3";

function storedRecord(key: string): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(key) ?? "null");
}

describe("new-thread draft revisions", () => {
  it("stamps each saved draft with a revision and the revision it replaced", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_alpha" });

    alpha.setDraft({ text: "first", mentions: [], attachments: [] });
    const first = storedRecord(ALPHA_KEY);
    alpha.setDraft({ text: "second", mentions: [], attachments: [] });
    const second = storedRecord(ALPHA_KEY);

    expect(first.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(second.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(second.rev).not.toBe(first.rev);
    expect(second.base).toBe(first.rev);
    expect(alpha.getCurrent().text).toBe("second");
  });
});

describe("new-thread drafts edited in two windows", () => {
  it("keeps the other window's unseen draft as a conflict copy before saving", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_alpha" });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    const otherWindowRecord = JSON.stringify({
      text: "theirs",
      attachments: [],
      rev: "aaaaaaaaaaaaaaaa",
      base: storedRecord(ALPHA_KEY).rev,
    });
    window.localStorage.setItem(ALPHA_KEY, otherWindowRecord);

    alpha.setDraft({ text: "mine, edited", mentions: [], attachments: [] });

    expect(
      window.localStorage.getItem(
        "bb.promptbox.conflict-new-thread-proj_alpha-aaaaaaaaaaaaaaaa-3",
      ),
    ).toBe(otherWindowRecord);
    expect(storedRecord(ALPHA_KEY).text).toBe("mine, edited");
    expect(storedRecord(ALPHA_KEY).base).toBe("aaaaaaaaaaaaaaaa");
  });

  it("adopts the other window's draft without a copy when the content is the same", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_alpha" });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    window.localStorage.setItem(
      ALPHA_KEY,
      JSON.stringify({ text: "same", attachments: [], rev: "bbbbbbbbbbbbbbbb" }),
    );

    alpha.setDraft({ text: "same", mentions: [], attachments: [] });

    expect(storedRecord(ALPHA_KEY).rev).toBe("bbbbbbbbbbbbbbbb");
    expect(
      Object.keys(window.localStorage).filter((key) => key.includes("conflict")),
    ).toEqual([]);
  });
});
