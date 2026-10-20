import { expect, it } from "vitest";
import { freshnessText, usageAllowance } from "./usage-details.js";

const now = Date.parse("2026-10-20T12:00:00.000Z");
const future = "2026-10-20T15:00:00.000Z";
const past = "2026-10-20T11:00:00.000Z";

it.each([
  [0, 100, false],
  [42.5, 57.5, false],
  [100, 0, false],
  [125, 0, true],
])("derives remaining only from reported usage %s", (used, remaining, over) => {
  expect(
    usageAllowance({ usedPercent: used, resetsAt: future }, now, now),
  ).toEqual({
    kind: "reported",
    usedPercent: used,
    remainingPercent: remaining,
    overLimit: over,
  });
});

it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  "keeps invalid or missing usage %s unavailable",
  (used) => {
    expect(
      usageAllowance({ usedPercent: used, resetsAt: null }, now, now),
    ).toEqual({ kind: "not-reported" });
  },
);

it("makes remaining unavailable when the reset passed after the last measurement", () => {
  const measuredBeforeReset = Date.parse("2026-10-20T10:00:00.000Z");
  expect(
    usageAllowance(
      { usedPercent: 90, resetsAt: past },
      measuredBeforeReset,
      now,
    ),
  ).toEqual({ kind: "reset-since-update" });
  expect(
    usageAllowance({ usedPercent: 90, resetsAt: past }, null, now),
  ).toEqual({ kind: "reset-since-update" });
  expect(
    usageAllowance(
      { usedPercent: 90, resetsAt: past },
      Date.parse("2026-10-20T11:30:00.000Z"),
      now,
    ),
  ).toMatchObject({ kind: "reported", remainingPercent: 10 });
});

it("states measurement age without treating retrieval or failure as fresh", () => {
  expect(freshnessText({ observedAt: null }, now)).toBe(
    "Last update unavailable",
  );
  expect(freshnessText({ observedAt: now - 5 * 60_000 }, now)).toBe(
    "Updated 5 min ago",
  );
  expect(
    freshnessText(
      { observedAt: now - 3 * 60 * 60_000, refreshFailed: true },
      now,
    ),
  ).toBe("Updated 3 hr ago · Couldn’t refresh");
  expect(freshnessText({ observedAt: now + 60_000 }, now)).toBe(
    "Updated just now",
  );
});
