// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPromptDraftAccessor,
  listNewThreadDraftsNotShown,
  discardNewThreadDraft,
  moveNewThreadDraft,
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

let alphaCounter = 0;
beforeEach(() => {
  alphaCounter += 1;
});
function alphaId(): string {
  return `proj_alpha${alphaCounter}`;
}
function alphaKey(): string {
  return `bb.promptbox.contents-new-thread-${alphaId()}-3`;
}

describe("project-scoped new-thread drafts", () => {
  it("keeps each project's draft separate and leaves the legacy draft untouched", () => {
    window.localStorage.setItem(NEW_THREAD_DRAFT_KEY, storedDraft("legacy text"));
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    const personal = getPromptDraftAccessor({ kind: "new-thread", projectId: "proj_personal" });

    alpha.setDraft({ text: "alpha text", mentions: [], attachments: [] });
    personal.setDraft({ text: "no project text", mentions: [], attachments: [] });

    expect(alpha.getCurrent().text).toBe("alpha text");
    expect(personal.getCurrent().text).toBe("no project text");
    expect(getPromptDraftAccessor({ kind: "new-thread", projectId: `${alphaId()}b` }).getCurrent().text).toBe("");
    expect(window.localStorage.getItem(NEW_THREAD_DRAFT_KEY)).toBe(storedDraft("legacy text"));
    expect(window.localStorage.getItem(alphaKey())).toContain("alpha text");
  });
});

describe("switching projects in the new-thread composer", () => {
  it("saves the origin draft at the switch and shows the destination draft", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      `bb.promptbox.contents-new-thread-${alphaId()}b-3`,
      storedDraft("beta text"),
    );
    const { result, rerender } = renderHook(
      ({ projectId }) => usePromptDraftStorage({ kind: "new-thread", projectId }),
      { initialProps: { projectId: alphaId() } },
    );

    act(() => result.current.setTextAndMentions("alpha typed", []));
    rerender({ projectId: `${alphaId()}b` });

    expect(result.current.text).toBe("beta text");
    expect(window.localStorage.getItem(alphaKey())).toContain(
      '"text":"alpha typed"',
    );
  });
});


function storedRecord(key: string): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(key) ?? "null");
}

describe("new-thread draft revisions", () => {
  it("stamps each saved draft with a revision and the revision it replaced", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });

    alpha.setDraft({ text: "first", mentions: [], attachments: [] });
    const first = storedRecord(alphaKey());
    alpha.setDraft({ text: "second", mentions: [], attachments: [] });
    const second = storedRecord(alphaKey());

    expect(first.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(second.rev).toMatch(/^[0-9a-f]{16}$/);
    expect(second.rev).not.toBe(first.rev);
    expect(second.base).toBe(first.rev);
    expect(alpha.getCurrent().text).toBe("second");
  });
});

describe("new-thread drafts edited in two windows", () => {
  it("keeps the other window's unseen draft as a conflict copy before saving", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    const otherWindowRecord = JSON.stringify({
      text: "theirs",
      attachments: [],
      rev: "aaaaaaaaaaaaaaaa",
      base: storedRecord(alphaKey()).rev,
    });
    window.localStorage.setItem(alphaKey(), otherWindowRecord);

    alpha.setDraft({ text: "mine, edited", mentions: [], attachments: [] });

    expect(
      window.localStorage.getItem(
        `bb.promptbox.conflict-new-thread-${alphaId()}-aaaaaaaaaaaaaaaa-3`,
      ),
    ).toBe(otherWindowRecord);
    expect(storedRecord(alphaKey()).text).toBe("mine, edited");
    expect(storedRecord(alphaKey()).base).toBe("aaaaaaaaaaaaaaaa");
  });

  it("adopts the other window's draft without a copy when the content is the same", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    window.localStorage.setItem(
      alphaKey(),
      JSON.stringify({ text: "same", attachments: [], rev: "bbbbbbbbbbbbbbbb" }),
    );

    alpha.setDraft({ text: "same", mentions: [], attachments: [] });

    expect(storedRecord(alphaKey()).rev).toBe("bbbbbbbbbbbbbbbb");
    expect(
      Object.keys(window.localStorage).filter((key) => key.includes("conflict")),
    ).toEqual([]);
  });
});

describe("new-thread draft save failures", () => {
  it("leaves the other window's draft in place and reports unsaved when its conflict copy fails", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    const otherWindowRecord = JSON.stringify({
      text: "theirs",
      attachments: [],
      rev: "cccccccccccccccc",
    });
    window.localStorage.setItem(alphaKey(), otherWindowRecord);
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key.startsWith("bb.promptbox.conflict-")) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        realSetItem.call(this, key, value);
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() =>
        result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }),
      );
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    expect(window.localStorage.getItem(alphaKey())).toBe(otherWindowRecord);
    expect(result.current.text).toBe("mine, edited");
    expect(result.current.isUnsaved).toBe(true);
  });

  it("never replaces an unsaved draft when another window's change arrives", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => result.current.setDraft({ text: "unsaved", mentions: [], attachments: [] }));
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
    window.localStorage.setItem(
      alphaKey(),
      JSON.stringify({ text: "from another window", attachments: [], rev: "dddddddddddddddd" }),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: alphaKey() }));
    });

    expect(result.current.text).toBe("unsaved");
  });
});

describe("clearing a new-thread draft after a send", () => {
  it("replaces a sent draft with a sent marker instead of removing it", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "send me", mentions: [], attachments: [] }));
    const sent = result.current.getCurrent();

    let cleared = false;
    act(() => {
      cleared = result.current.clearIfCurrentMatches(sent);
    });

    expect(cleared).toBe(true);
    expect(result.current.text).toBe("");
    expect(storedRecord(alphaKey())).toMatchObject({ sent: true });
    expect(storedRecord(alphaKey()).rev).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps another window's newer draft when the send succeeds", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "send me", mentions: [], attachments: [] }));
    const sent = result.current.getCurrent();
    const otherWindowRecord = JSON.stringify({
      text: "written in another window",
      attachments: [],
      rev: "eeeeeeeeeeeeeeee",
    });
    window.localStorage.setItem(alphaKey(), otherWindowRecord);

    let cleared = true;
    act(() => {
      cleared = result.current.clearIfCurrentMatches(sent);
    });

    expect(cleared).toBe(false);
    expect(window.localStorage.getItem(alphaKey())).toBe(otherWindowRecord);
  });

  it("keeps text typed during the send that hasn't been saved yet", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "send me", mentions: [], attachments: [] }));
    const sent = result.current.getCurrent();
    act(() => result.current.setTextAndMentions("send me, then more", []));

    let cleared = true;
    act(() => {
      cleared = result.current.clearIfCurrentMatches(sent);
    });
    act(() => vi.advanceTimersByTime(250));

    expect(cleared).toBe(false);
    expect(result.current.text).toBe("send me, then more");
    expect(storedRecord(alphaKey()).text).toBe("send me, then more");
  });

  it("keeps another window's draft when the sent text was still waiting to be saved", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "older", mentions: [], attachments: [] }));
    act(() => result.current.setTextAndMentions("send me", []));
    const sent = result.current.getCurrent();
    const otherWindowRecord = JSON.stringify({
      text: "written in another window",
      attachments: [],
      rev: "ffffffffffffffff",
    });
    window.localStorage.setItem(alphaKey(), otherWindowRecord);

    act(() => {
      result.current.clearIfCurrentMatches(sent);
    });
    act(() => vi.advanceTimersByTime(250));

    expect(
      [window.localStorage.getItem(alphaKey()), ...Object.keys(window.localStorage)
        .filter((key) => key.startsWith("bb.promptbox.conflict-"))
        .map((key) => window.localStorage.getItem(key))],
    ).toContain(otherWindowRecord);
    expect(storedRecord(alphaKey()).sent).toBeUndefined();
  });
});


describe("the new-thread save check", () => {
  function renderAlpha() {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    return result;
  }

  it.each([
    ["moved", JSON.stringify({ rev: "1111111111111111", moved: true }), "moved-elsewhere"],
    ["discarded", JSON.stringify({ rev: "2222222222222222", discarded: true }), "moved-elsewhere"],
    ["unreadable", "{not json", "unreadable"],
    [
      "unreadable item",
      JSON.stringify({ text: "x", attachments: [{ bogus: true }], rev: "3333333333333333" }),
      "unreadable",
    ],
  ])("never writes over a %s record and keeps this window's text", (_, stored, notice) => {
    const result = renderAlpha();
    window.localStorage.setItem(alphaKey(), stored);

    act(() => result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }));

    expect(window.localStorage.getItem(alphaKey())).toBe(stored);
    expect(result.current.text).toBe("mine, edited");
    expect(result.current.notice).toBe(notice);
  });

  it("writes over a sent marker and says the draft was sent from another window", () => {
    const result = renderAlpha();
    window.localStorage.setItem(
      alphaKey(),
      JSON.stringify({ rev: "4444444444444444", sent: true }),
    );

    act(() => result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }));

    expect(storedRecord(alphaKey()).text).toBe("mine, edited");
    expect(result.current.notice).toBe("sent-elsewhere");
  });
});

describe("another window's new-thread change arriving", () => {
  function renderSavedAlpha() {
    const hook = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => hook.result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    return { result: hook.result, myRev: String(storedRecord(alphaKey()).rev) };
  }

  function arrive(record: Record<string, unknown>) {
    window.localStorage.setItem(alphaKey(), JSON.stringify(record));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: alphaKey() }));
    });
  }

  function conflictCopies(): string[] {
    return Object.keys(window.localStorage).filter((key) =>
      key.startsWith("bb.promptbox.conflict-"),
    );
  }

  it("adopts a change written over this window's draft", () => {
    const { result, myRev } = renderSavedAlpha();
    arrive({ text: "theirs", attachments: [], rev: "5555555555555555", base: myRev });

    expect(result.current.text).toBe("theirs");
    expect(conflictCopies()).toEqual([]);
  });

  it("keeps this window's draft as a conflict copy when the change never saw it", () => {
    const { result, myRev } = renderSavedAlpha();
    arrive({ text: "theirs", attachments: [], rev: "6666666666666666", base: "0000000000000000" });

    expect(result.current.text).toBe("theirs");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `bb.promptbox.conflict-new-thread-${alphaId()}-${myRev}-3`,
        ) ?? "null",
      ),
    ).toMatchObject({ text: "mine" });
  });

  it.each([
    [{ rev: "7777777777777777", sent: true }, "sent-elsewhere"],
    [{ rev: "8888888888888888", moved: true }, "moved-elsewhere"],
  ])("keeps this window's text and says why when a marker arrives", (record, notice) => {
    const { result } = renderSavedAlpha();
    arrive(record);

    expect(result.current.text).toBe("mine");
    expect(result.current.notice).toBe(notice);
    expect(conflictCopies()).toEqual([]);
  });
});

describe("new-thread recovery copies", () => {
  function recoveryKeys(): string[] {
    return Object.keys(window.localStorage).filter((key) =>
      key.startsWith(`bb.promptbox.recovery-new-thread-${alphaId()}-`),
    );
  }

  it("saves this tab's content to its own recovery copy with the shared draft's revision", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });

    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });

    const [recoveryKey] = recoveryKeys();
    expect(recoveryKeys()).toHaveLength(1);
    expect(recoveryKey).toMatch(/-[0-9a-f]{16}-3$/);
    expect(JSON.parse(window.localStorage.getItem(recoveryKey!) ?? "null")).toMatchObject({
      text: "mine",
      rev: storedRecord(alphaKey()).rev,
    });
  });

  it("keeps the recovery copy when another tab overwrites the draft without seeing it", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    const mine = storedRecord(alphaKey());
    window.localStorage.setItem(
      alphaKey(),
      JSON.stringify({ text: "theirs", attachments: [], rev: "9999999999999999", base: "0000000000000000" }),
    );

    expect(recoveryKeys().map((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"))).toEqual([
      expect.objectContaining({ text: "mine", rev: mine.rev }),
    ]);
  });

  it("removes a recovery copy once a later save has read its revision", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    const firstRev = storedRecord(alphaKey()).rev;
    window.localStorage.setItem(
      `bb.promptbox.recovery-new-thread-${alphaId()}-abcdefabcdefabcd-3`,
      JSON.stringify({ text: "mine", attachments: [], rev: firstRev }),
    );

    alpha.setDraft({ text: "mine, edited", mentions: [], attachments: [] });

    const remaining = recoveryKeys().map((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"));
    expect(remaining.some((record) => record.rev === firstRev)).toBe(false);
  });
});

describe("moving the pre-upgrade draft into a project", () => {
  const LEGACY_KEY = "bb.promptbox.contents-draft-3";

  it("appends the text to the project's draft and leaves untagged attachments behind", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        text: "legacy text",
        attachments: [{ type: "localImage", path: "old.png", name: "old.png", sizeBytes: 1 }],
      }),
    );
    const target = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    target.setDraft({ text: "alpha text", mentions: [], attachments: [] });

    const result = moveNewThreadDraft(LEGACY_KEY, alphaId());

    expect(result).toEqual({ status: "moved", leftoverAttachments: ["old.png"] });
    expect(target.getCurrent().text).toBe("alpha text\n\nlegacy text");
    expect(target.getCurrent().attachments).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "null")).toMatchObject({
      text: "",
      attachments: [{ path: "old.png" }],
    });
  });

  it("marks a fully moved draft as moved so a second move adds nothing", () => {
    window.localStorage.setItem(LEGACY_KEY, storedDraft("legacy text"));
    const target = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });

    moveNewThreadDraft(LEGACY_KEY, alphaId());
    const second = moveNewThreadDraft(LEGACY_KEY, alphaId());

    expect(second.status).toBe("nothing-to-move");
    expect(target.getCurrent().text).toBe("legacy text");
    expect(JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "null")).toMatchObject({
      moved: true,
    });
  });

  it("changes nothing when the project's draft can't be saved", () => {
    window.localStorage.setItem(LEGACY_KEY, storedDraft("legacy text"));
    const target = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    target.setDraft({ text: "alpha text", mentions: [], attachments: [] });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = moveNewThreadDraft(LEGACY_KEY, alphaId());
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    expect(result).toEqual({ status: "failed" });
    expect(target.getCurrent().text).toBe("alpha text");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe(storedDraft("legacy text"));
  });
});

describe("discarding a draft the composer doesn't show", () => {
  const LEGACY_KEY = "bb.promptbox.contents-draft-3";

  function backups(): string[] {
    return Object.keys(window.localStorage).filter((key) =>
      key.startsWith("bb.promptbox.unreadable-draft-"),
    );
  }

  it("marks a readable draft as discarded instead of removing it", () => {
    window.localStorage.setItem(LEGACY_KEY, storedDraft("legacy text"));

    expect(discardNewThreadDraft(LEGACY_KEY)).toBe("discarded");
    expect(JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "null")).toMatchObject({
      discarded: true,
    });
  });

  it("backs up each unreadable value under its own key before discarding it", () => {
    window.localStorage.setItem(LEGACY_KEY, "{first bad");
    discardNewThreadDraft(LEGACY_KEY);
    window.localStorage.setItem(LEGACY_KEY, "{second bad");
    discardNewThreadDraft(LEGACY_KEY);

    expect(backups().map((key) => window.localStorage.getItem(key)).sort()).toEqual([
      "{first bad",
      "{second bad",
    ]);
    expect(backups().every((key) => /-[0-9a-f]{16}-3$/.test(key))).toBe(true);
  });

  it("leaves an unreadable value in place when its backup can't be saved", () => {
    window.localStorage.setItem(LEGACY_KEY, "{bad");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = discardNewThreadDraft(LEGACY_KEY);
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    expect(result).toBe("failed");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe("{bad");
  });
});

describe("listing saved drafts the composer doesn't show", () => {
  it("lists the pre-upgrade draft, unreadable records, conflict copies, unseen recovery copies and unlisted projects", () => {
    const listed = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    listed.setDraft({ text: "listed project", mentions: [], attachments: [] });
    const listedRev = String(storedRecord(alphaKey()).rev);
    window.localStorage.setItem("bb.promptbox.contents-draft-3", storedDraft("legacy"));
    window.localStorage.setItem(
      "bb.promptbox.contents-new-thread-proj_gone-3",
      JSON.stringify({ text: "gone", attachments: [], rev: "1234123412341234" }),
    );
    window.localStorage.setItem("bb.promptbox.contents-new-thread-proj_bad-3", "{bad");
    window.localStorage.setItem(
      "bb.promptbox.contents-new-thread-proj_sent-3",
      JSON.stringify({ rev: "5678567856785678", sent: true }),
    );
    window.localStorage.setItem(
      "bb.promptbox.contents-new-thread-proj_personal-3",
      storedDraft("no project"),
    );
    window.localStorage.setItem(
      `bb.promptbox.conflict-new-thread-${alphaId()}-abababababababab-3`,
      JSON.stringify({ text: "conflict", attachments: [], rev: "abababababababab" }),
    );
    window.localStorage.setItem(
      `bb.promptbox.recovery-new-thread-${alphaId()}-cdcdcdcdcdcdcdcd-3`,
      JSON.stringify({ text: "lost race", attachments: [], rev: "efefefefefefefef", base: "0000000000000000" }),
    );

    const rows = listNewThreadDraftsNotShown([alphaId()]);

    expect(rows.map(({ kind, projectId }) => [kind, projectId]).sort()).toEqual(
      [
        ["conflict", alphaId()],
        ["conflict", alphaId()],
        ["legacy", null],
        ["unlisted-project", "proj_gone"],
        ["unreadable", "proj_bad"],
      ].sort(),
    );
    expect(rows.some((row) => row.draft?.text === "listed project" || row.draft?.text === "no project")).toBe(false);
    expect(listedRev).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("reloading the app", () => {
  it("restores each project's draft, including typing flushed as the page closed", async () => {
    vi.useFakeTimers();
    const before = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => before.result.current.setDraft({ text: "saved", mentions: [], attachments: [] }));
    act(() => before.result.current.setTextAndMentions("saved, then typed", []));
    window.dispatchEvent(new Event("pagehide"));
    before.unmount();

    vi.resetModules();
    const reloaded = await import("./usePromptDraftStorage");
    const alpha = reloaded.getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    const other = reloaded.getPromptDraftAccessor({ kind: "new-thread", projectId: `${alphaId()}b` });

    expect(alpha.getCurrent().text).toBe("saved, then typed");
    expect(other.getCurrent().text).toBe("");
  });
});

describe("answering a notice about another window", () => {
  it("saves this window's text over a moved marker when the user keeps their copy", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    window.localStorage.setItem(alphaKey(), JSON.stringify({ rev: "1212121212121212", moved: true }));
    act(() => result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }));

    act(() => result.current.keepMyCopy());

    expect(storedRecord(alphaKey())).toMatchObject({ text: "mine, edited", base: "1212121212121212" });
    expect(result.current.notice).toBeNull();
    expect(result.current.isUnsaved).toBe(false);
  });

  it("clears a sent-elsewhere notice when dismissed", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    window.localStorage.setItem(alphaKey(), JSON.stringify({ rev: "3434343434343434", sent: true }));
    act(() => result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }));

    act(() => result.current.dismissNotice());

    expect(result.current.notice).toBeNull();
    expect(result.current.text).toBe("mine, edited");
  });
});

describe("new-thread saves with Web Locks", () => {
  let releases: (() => void)[] = [];

  beforeEach(() => {
    releases = [];
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (_name: string, optionsOrCallback: unknown, maybeCallback?: () => unknown) => {
          const callback = (maybeCallback ?? optionsOrCallback) as () => unknown;
          return new Promise((resolve) => {
            releases.push(() => resolve(callback()));
          });
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const release of releases.splice(0)) release();
    });
    Reflect.deleteProperty(navigator, "locks");
    window.localStorage.clear();
  });

  it("saves only once it holds the draft's lock, and keeps the draft readable meanwhile", async () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });

    alpha.setDraft({ text: "waiting for the lock", mentions: [], attachments: [] });

    expect(window.localStorage.getItem(alphaKey())).toBeNull();
    expect(alpha.getCurrent().text).toBe("waiting for the lock");
    await act(async () => releases.shift()?.());
    expect(storedRecord(alphaKey()).text).toBe("waiting for the lock");
  });

  it("saves only to this tab's recovery copy when the page closes before the lock arrives", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "typed before close", mentions: [], attachments: [] });

    window.dispatchEvent(new Event("pagehide"));

    expect(window.localStorage.getItem(alphaKey())).toBeNull();
    const recovery = Object.keys(window.localStorage).find((key) =>
      key.startsWith(`bb.promptbox.recovery-new-thread-${alphaId()}-`),
    );
    expect(JSON.parse(window.localStorage.getItem(recovery!) ?? "null")).toMatchObject({
      text: "typed before close",
    });
  });
});

describe("restoring a close-time recovery copy", () => {
  it("shows the text saved as the page closed and saves it as the project's draft", async () => {
    window.localStorage.setItem(
      alphaKey(),
      JSON.stringify({ text: "saved", attachments: [], rev: "a1a1a1a1a1a1a1a1" }),
    );
    const recoveryKey = `bb.promptbox.recovery-new-thread-${alphaId()}-b2b2b2b2b2b2b2b2-3`;
    window.localStorage.setItem(
      recoveryKey,
      JSON.stringify({ text: "typed before close", attachments: [], rev: "c3c3c3c3c3c3c3c3", base: "a1a1a1a1a1a1a1a1" }),
    );

    vi.resetModules();
    const reloaded = await import("./usePromptDraftStorage");
    const alpha = reloaded.getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });

    expect(alpha.getCurrent().text).toBe("typed before close");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(storedRecord(alphaKey())).toMatchObject({ text: "typed before close", base: "a1a1a1a1a1a1a1a1" });
    expect(window.localStorage.getItem(recoveryKey)).toBeNull();
    expect(reloaded.listNewThreadDraftsNotShown([alphaId()])).toEqual([]);
  });
});

describe("review fixes: terminal writes", () => {
  it("doesn't list the sent text as a conflict copy after a send", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "send me", mentions: [], attachments: [] }));
    act(() => {
      result.current.clearIfCurrentMatches(result.current.getCurrent());
    });

    expect(listNewThreadDraftsNotShown([alphaId()])).toEqual([]);
  });

  it("reports a send clear as failed when the sent marker can't be saved", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "send me", mentions: [], attachments: [] }));
    const sent = result.current.getCurrent();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let cleared = true;
    try {
      act(() => {
        cleared = result.current.clearIfCurrentMatches(sent);
      });
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    expect(cleared).toBe(false);
    expect(result.current.text).toBe("send me");
  });

  it("doesn't list moved or discarded text as a conflict copy", () => {
    const source = getPromptDraftAccessor({ kind: "new-thread", projectId: `${alphaId()}src` });
    source.setDraft({ text: "move me", mentions: [], attachments: [] });
    const discarded = getPromptDraftAccessor({ kind: "new-thread", projectId: `${alphaId()}gone` });
    discarded.setDraft({ text: "discard me", mentions: [], attachments: [] });

    moveNewThreadDraft(source.storageKey, alphaId());
    discardNewThreadDraft(discarded.storageKey);

    expect(listNewThreadDraftsNotShown([alphaId(), `${alphaId()}src`, `${alphaId()}gone`])).toEqual([]);
  });
});

describe("review fixes: discard", () => {
  const LEGACY_KEY = "bb.promptbox.contents-draft-3";

  it("stops when the draft changed after the user saw it", () => {
    window.localStorage.setItem(LEGACY_KEY, storedDraft("A"));
    const seen = { text: "A", mentions: [], attachments: [] };
    window.localStorage.setItem(LEGACY_KEY, storedDraft("AB"));

    expect(discardNewThreadDraft(LEGACY_KEY, seen)).toBe("changed");
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe(storedDraft("AB"));
  });

  it("keeps a backup of a readable draft it discards", () => {
    window.localStorage.setItem(LEGACY_KEY, storedDraft("A"));

    discardNewThreadDraft(LEGACY_KEY, { text: "A", mentions: [], attachments: [] });

    expect(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("bb.promptbox.unreadable-draft-") || key.startsWith("bb.promptbox.discarded-draft-"))
        .map((key) => window.localStorage.getItem(key)),
    ).toEqual([storedDraft("A")]);
  });
});

describe("review fixes: failed saves", () => {
  function failNextWrites(run: () => void) {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      run();
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
  }

  it("makes no conflict copy of this window's own text when a failed save is retried", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "one", mentions: [], attachments: [] });
    failNextWrites(() => alpha.setDraft({ text: "one, two", mentions: [], attachments: [] }));

    alpha.setDraft({ text: "one, two, three", mentions: [], attachments: [] });

    expect(storedRecord(alphaKey()).text).toBe("one, two, three");
    expect(listNewThreadDraftsNotShown([alphaId()])).toEqual([]);
  });

  it("brings back text whose save failed after a reload", async () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "saved", mentions: [], attachments: [] });
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === alphaKey()) throw new DOMException("quota", "QuotaExceededError");
        realSetItem.call(this, key, value);
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      alpha.setDraft({ text: "newest, not saved", mentions: [], attachments: [] });
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    vi.resetModules();
    const reloaded = await import("./usePromptDraftStorage");

    expect(
      reloaded.getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() }).getCurrent().text,
    ).toBe("newest, not saved");
  });
});

describe("review fixes: unreadable change from another window", () => {
  it("keeps this window's text and says the saved draft can't be read", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    window.localStorage.setItem(alphaKey(), "{bad");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: alphaKey() }));
    });

    expect(result.current.text).toBe("mine");
    expect(result.current.notice).toBe("unreadable");
  });
});

describe("review fixes: smaller gaps", () => {
  it("keeps a stored draft that has no revision as a conflict copy before saving over it", () => {
    const alpha = getPromptDraftAccessor({ kind: "new-thread", projectId: alphaId() });
    alpha.setDraft({ text: "mine", mentions: [], attachments: [] });
    window.localStorage.setItem(alphaKey(), storedDraft("no revision"));

    alpha.setDraft({ text: "mine, edited", mentions: [], attachments: [] });

    expect(listNewThreadDraftsNotShown([alphaId()]).map((row) => row.draft?.text)).toEqual([
      "no revision",
    ]);
  });

  it("still reports the target as unsaved after a move into it fails", () => {
    window.localStorage.setItem("bb.promptbox.contents-draft-3", storedDraft("legacy"));
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => result.current.setDraft({ text: "unsaved target", mentions: [], attachments: [] }));
      act(() => {
        moveNewThreadDraft("bb.promptbox.contents-draft-3", alphaId());
      });
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }

    expect(result.current.text).toBe("unsaved target");
    expect(result.current.isUnsaved).toBe(true);
  });

  it("recognizes moved text that a pre-upgrade window writes back", () => {
    const LEGACY_KEY = "bb.promptbox.contents-draft-3";
    window.localStorage.setItem(LEGACY_KEY, storedDraft("hello"));
    moveNewThreadDraft(LEGACY_KEY, alphaId());
    window.localStorage.setItem(LEGACY_KEY, storedDraft("hello"));

    expect(listNewThreadDraftsNotShown([alphaId()])).toEqual([
      expect.objectContaining({ kind: "legacy", alreadyMoved: true }),
    ]);
  });
});

describe("review fixes: resolving an unreadable visible draft", () => {
  it("saves this window's text once the unreadable record is discarded", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread", projectId: alphaId() }),
    );
    act(() => result.current.setDraft({ text: "mine", mentions: [], attachments: [] }));
    window.localStorage.setItem(alphaKey(), "{bad");
    act(() => result.current.setDraft({ text: "mine, edited", mentions: [], attachments: [] }));

    act(() => {
      discardNewThreadDraft(alphaKey());
    });

    expect(result.current.text).toBe("mine, edited");
    expect(result.current.notice).toBeNull();
    expect(result.current.isUnsaved).toBe(false);
    expect(storedRecord(alphaKey()).text).toBe("mine, edited");
  });
});
