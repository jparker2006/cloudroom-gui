import { describe, expect, it } from "vitest";
import {
  buildSuggestions,
  classifyGhFailure,
  parsePullUrl,
  summarizeChecks,
  matchesQuery,
  parseQuery,
  parseSubPath,
  routeToSubPath,
  type Item,
  type Route,
} from "./app-logic.js";

const issue: Item = {
  repo: "acme/widgets",
  number: 7,
  kind: "issue",
  title: "Fix cache invalidation",
  state: "OPEN",
  author: "alice",
  labels: ["bug", "good first issue"],
  assignees: ["octocat"],
  url: "https://github.com/acme/widgets/issues/7",
  body: "",
  updatedAt: "2026-08-19T12:00:00Z",
};

describe("github panel routes", () => {
  it("round-trips list, create, issue, and pull routes", () => {
    const routes: Route[] = [
      { view: "issues" },
      { view: "pulls" },
      { view: "new" },
      { view: "issue", repo: "acme/widgets", number: 7 },
      { view: "pull", repo: "get-bb/bb", number: 42 },
    ];

    for (const route of routes) {
      expect(parseSubPath(routeToSubPath(route))).toEqual(route);
    }
  });

  it("falls back to the owning list for malformed detail paths", () => {
    expect(parseSubPath("pulls/acme/widgets/not-a-number")).toEqual({
      view: "pulls",
    });
    expect(parseSubPath("issues/acme/widgets/not-a-number")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("issues/acme/widgets/7/extra")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("")).toEqual({ view: "issues" });
  });
});

describe("github panel query engine", () => {
  it("parses quoted qualifiers and matches viewer-relative filters", () => {
    const parsed = parseQuery(
      'is:open assignee:@me author:alice label:"good first issue" repo:acme/widgets #7',
    );

    expect(parsed).toEqual({
      states: ["OPEN"],
      assignees: ["@me"],
      authors: ["alice"],
      labels: ["good first issue"],
      repos: ["acme/widgets"],
      noAssignee: false,
      noLabel: false,
      text: ["#7"],
    });
    expect(matchesQuery(issue, parsed, "octocat")).toBe(true);
    expect(matchesQuery(issue, parsed, null)).toBe(false);
  });

  it("applies negative, state, and plain-text filters independently", () => {
    expect(matchesQuery(issue, parseQuery("is:closed"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("no:assignee"), "octocat")).toBe(
      false,
    );
    expect(matchesQuery(issue, parseQuery("no:label"), "octocat")).toBe(false);
    expect(
      matchesQuery(issue, parseQuery("cache acme/widgets"), "octocat"),
    ).toBe(true);
    expect(matchesQuery(issue, parseQuery("missing"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("state:"), "octocat")).toBe(true);
  });

  it("builds bounded qualifier values without losing labels containing spaces", () => {
    const vocab = {
      users: ["alice", "octocat"],
      labels: ["bug", "good first issue"],
      repos: ["acme/widgets"],
    };
    const compact = (token: string, kind: "issue" | "pr") =>
      buildSuggestions(token, vocab, kind, "octocat").map(
        ({ insert, label }) => ({ insert, label }),
      );

    expect(compact("is:", "pr")).toEqual([
      { insert: "is:open ", label: "open" },
      { insert: "is:closed ", label: "closed" },
      { insert: "is:merged ", label: "merged" },
    ]);
    expect(compact("label:good", "issue")).toEqual([
      {
        insert: 'label:"good first issue" ',
        label: "good first issue",
      },
    ]);
    expect(compact("assignee:@", "issue")).toEqual([
      { insert: "assignee:@me ", label: "@me (octocat)" },
    ]);
    expect(compact("no:l", "issue")).toEqual([
      { insert: "no:label ", label: "no:label" },
    ]);
    expect(compact("unknown:value", "issue")).toEqual([]);
    expect(buildSuggestions("is:o", vocab, "pr", "octocat")[0]?.icon).toEqual({
      kind: "state",
      itemKind: "pr",
      state: "OPEN",
    });
    expect(
      buildSuggestions("author:ali", vocab, "issue", "octocat")[0]?.icon,
    ).toEqual({ kind: "avatar", login: "alice" });
  });
});

describe("session pull request truth helpers", () => {
  it("never summarizes unknown, absent, or neutral-only checks as passing", () => {
    expect(summarizeChecks(null)).toEqual({ state: "unknown" });
    expect(summarizeChecks([])).toEqual({ state: "none" });
    expect(summarizeChecks([{ status: "neutral" }]).state).toBe("neutral");
    expect(
      summarizeChecks([{ status: "success" }, { status: "unknown" }]).state,
    ).toBe("unknown_results");
    expect(
      summarizeChecks([{ status: "success" }, { status: "pending" }]).state,
    ).toBe("pending");
    expect(
      summarizeChecks([{ status: "pending" }, { status: "failure" }]).state,
    ).toBe("failing");
    expect(
      summarizeChecks([{ status: "success" }, { status: "neutral" }]),
    ).toEqual({
      state: "passing",
      total: 2,
      passed: 1,
      failed: 0,
      pending: 0,
      unknown: 0,
      neutral: 1,
    });
  });

  it("separates authentication from unavailable and other lookup failures", () => {
    expect(
      classifyGhFailure("gh pr view failed: please run: gh auth login"),
    ).toBe("auth");
    expect(classifyGhFailure("HTTP 401: Bad credentials")).toBe("auth");
    expect(classifyGhFailure("HTTP 502 Bad Gateway")).toBe("unavailable");
    expect(classifyGhFailure("connect ETIMEDOUT 140.82.112.3:443")).toBe(
      "unavailable",
    );
    expect(classifyGhFailure("unexpected token in JSON")).toBe("lookup");
    expect(
      classifyGhFailure(
        "HTTP 403: Resource protected by organization SAML enforcement",
      ),
    ).toBe("auth");
    expect(
      classifyGhFailure("HTTP 403: Resource not accessible by integration"),
    ).toBe("auth");
    expect(classifyGhFailure("HTTP 403: API rate limit exceeded")).toBe(
      "unavailable",
    );
    expect(classifyGhFailure("Host is not connected")).toBe("unavailable");
    expect(classifyGhFailure("Host is suspended")).toBe("unavailable");
    expect(classifyGhFailure("error connecting to api.github.com")).toBe(
      "unavailable",
    );
    expect(
      classifyGhFailure("GraphQL: Could not resolve to a PullRequest"),
    ).toBe("lookup");
    expect(classifyGhFailure("workspace offline", "unavailable")).toBe(
      "unavailable",
    );
  });

  it("accepts only canonical GitHub pull request URLs", () => {
    expect(parsePullUrl("https://github.com/acme/widgets/pull/42")).toEqual({
      repo: "acme/widgets",
      number: 42,
    });
    expect(
      parsePullUrl("https://github.com/acme/widgets/issues/42"),
    ).toBeNull();
    expect(
      parsePullUrl("https://evil.example/github.com/acme/widgets/pull/42"),
    ).toBeNull();
  });
});
