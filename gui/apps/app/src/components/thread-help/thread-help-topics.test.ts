import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  THREAD_HELP_DOCS,
  THREAD_HELP_TOPICS,
  relevantThreadHelpTopicIds,
  searchThreadHelp,
  threadHelpHref,
  threadHelpLinkFromHash,
  threadHelpTopicFromHash,
} from "./thread-help-topics";

const here = dirname(fileURLToPath(import.meta.url));
const guiRoot = resolve(here, "../../../../..");
const ids = (topics: { id: string }[]) => topics.map((topic) => topic.id);
const text = (topic: (typeof THREAD_HELP_TOPICS)[number]) =>
  [topic.title, topic.summary, ...topic.points, topic.nextStep ?? ""].join(" ");

describe("thread help topics", () => {
  it("have unique kebab-case ids, existing related topics, and no self links", () => {
    const all = new Set(ids([...THREAD_HELP_TOPICS]));
    expect(all.size).toBe(THREAD_HELP_TOPICS.length);
    for (const topic of THREAD_HELP_TOPICS) {
      expect(topic.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(topic.related).not.toContain(topic.id);
      for (const id of topic.related) expect(all.has(id)).toBe(true);
    }
  });

  it("cite source files that still exist", () => {
    for (const topic of THREAD_HELP_TOPICS) {
      expect(topic.sources.length).toBeGreaterThan(0);
      for (const source of topic.sources)
        expect(existsSync(join(guiRoot, source)), source).toBe(true);
    }
  });

  it("link only to the verified public docs list", () => {
    const verified = new Set<string>(Object.values(THREAD_HELP_DOCS));
    for (const topic of THREAD_HELP_TOPICS) {
      expect(verified.has(topic.docs.href), topic.docs.href).toBe(true);
      expect(topic.docs.href.startsWith("https://www.cloudroom.dev/")).toBe(
        true,
      );
    }
  });

  it("keep answers short", () => {
    for (const topic of THREAD_HELP_TOPICS) {
      expect(topic.summary.length).toBeLessThanOrEqual(160);
      expect(topic.points.length).toBeLessThanOrEqual(5);
      expect(text(topic).length).toBeLessThanOrEqual(1100);
    }
  });

  it("never equate awake with working or idle with done", () => {
    const all = THREAD_HELP_TOPICS.map(text).join(" ").toLowerCase();
    expect(all).not.toMatch(
      /awake (means|=) (the agent is )?(working|thinking|active)/,
    );
    expect(all).not.toMatch(
      /idle (means|=) (the task is )?(done|finished|complete)/,
    );
    expect(all).toContain("awake does not mean the agent is thinking");
    expect(all).toContain("idle does not mean the task is done");
  });

  it("keep missing, stale and estimated data explicit", () => {
    const context = THREAD_HELP_TOPICS.find(
      (topic) => topic.id === "context-usage",
    );
    const limits = THREAD_HELP_TOPICS.find((topic) => topic.id === "limits");
    expect(context && text(context)).toMatch(/does not mean zero/);
    expect(context && text(context)).toMatch(/estimate/i);
    expect(context && text(context)).toMatch(/lag/);
    expect(limits && text(limits)).toMatch(/unavailable, never as zero/);
  });
});

describe("searchThreadHelp", () => {
  it("returns every topic in catalog order for an empty query", () => {
    expect(ids(searchThreadHelp("  "))).toEqual(ids([...THREAD_HELP_TOPICS]));
  });

  it("finds topics by keyword, prefix and title, title hits first", () => {
    expect(ids(searchThreadHelp("sleep"))[0]).toBe("awake-connected-working");
    expect(ids(searchThreadHelp("compac"))[0]).toBe("compactions");
    expect(ids(searchThreadHelp("Reconnect!"))[0]).toBe("reconnecting");
    expect(ids(searchThreadHelp("quota"))).toEqual(["limits", "context-usage"]);
    expect(ids(searchThreadHelp("worktree"))[0]).toBe("where-it-runs");
  });

  it("ignores stop words in natural questions", () => {
    expect(ids(searchThreadHelp("how do I see context"))[0]).toBe(
      "context-usage",
    );
    expect(ids(searchThreadHelp("my agent is stuck"))[0]).toBe(
      "awake-connected-working",
    );
  });

  it("requires every word to match", () => {
    expect(ids(searchThreadHelp("context estimated"))).toEqual([
      "context-usage",
    ]);
    expect(searchThreadHelp("context kubernetes")).toEqual([]);
  });

  it("returns nothing for unknown words and is deterministic", () => {
    expect(searchThreadHelp("kubernetes")).toEqual([]);
    expect(searchThreadHelp("???")).toEqual([]);
    expect(searchThreadHelp("接続")).toEqual([]);
    expect(searchThreadHelp("how do I")).toEqual([]);
    expect(ids(searchThreadHelp("host"))).toEqual(
      ids(searchThreadHelp("HOST")),
    );
  });
});

describe("topic links", () => {
  it("round-trip through the stable hash", () => {
    for (const topic of THREAD_HELP_TOPICS) {
      expect(threadHelpTopicFromHash(threadHelpHref(topic.id))?.id).toBe(
        topic.id,
      );
    }
    expect(threadHelpTopicFromHash("#thread-help/nope")).toBeNull();
    expect(threadHelpTopicFromHash("#configuration")).toBeNull();
    expect(threadHelpLinkFromHash("#thread-help")).toEqual({ topicId: null });
    expect(threadHelpLinkFromHash("#thread-help/limits")).toEqual({
      topicId: "limits",
    });
    expect(threadHelpLinkFromHash("#thread-help/nope")).toBeNull();
    expect(threadHelpLinkFromHash("#thread-helpx")).toBeNull();
  });
});

describe("relevantThreadHelpTopicIds", () => {
  const base = {
    isCloud: false,
    hasContextUsage: false,
    reconnecting: false,
    hostDisconnected: false,
    authRequired: false,
    startFailed: false,
    usageLimit: false,
  };

  it("always explains where the thread runs and puts active problems first", () => {
    expect(relevantThreadHelpTopicIds(base)).toEqual(["where-it-runs"]);
    expect(
      relevantThreadHelpTopicIds({
        ...base,
        isCloud: true,
        hasContextUsage: true,
        usageLimit: true,
      }),
    ).toEqual([
      "limits",
      "where-it-runs",
      "awake-connected-working",
      "context-usage",
    ]);
  });
});

describe("help corpus boundary", () => {
  it("does not import AI, network, docs-vault or settings-mutation code", () => {
    for (const file of readdirSync(here).filter(
      (name) => /\.tsx?$/.test(name) && !name.includes(".test."),
    )) {
      const source = readFileSync(join(here, file), "utf8");
      expect(source, file).not.toMatch(
        /from "[^"]*(plugins\/docs|@\/sdk|hooks\/queries|anthropic|openai)|fetch\(|useMutation|useQuery/i,
      );
    }
  });
});
