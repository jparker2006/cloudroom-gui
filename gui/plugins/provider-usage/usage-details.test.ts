import { expect, it } from "vitest";
import {
  freshnessText,
  paceText,
  usageAllowance,
  usagePace,
  usagePaceMessages,
} from "./usage-details.js";

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

const FIVE_HOURS = 5 * 3600_000;
const sample = (elapsed: number, usedPercent: number | null) => {
  const observedAt = now;
  return {
    window: {
      kind: "five-hour" as const,
      usedPercent,
      resetsAt: new Date(observedAt + (1 - elapsed) * FIVE_HOURS).toISOString(),
    },
    observedAt,
  };
};
const paceOf = (elapsed: number, used: number | null, at = now) => {
  const { window, observedAt } = sample(elapsed, used);
  return usagePace(window, observedAt, at);
};

it.each([
  [52, "on-pace"],
  [48, "on-pace"],
  [52.5, "deficit"],
  [47.5, "reserve"],
])(
  "treats ±2 points around even usage inclusively (%s%% used at half way)",
  (used, status) => {
    expect(paceOf(0.5, used)).toMatchObject({ kind: "estimate", status });
  },
);

it("reports deficit and reserve in percentage points from actual used percent", () => {
  expect(paceOf(0.25, 40)).toMatchObject({ status: "deficit", points: 15 });
  expect(paceOf(0.25, 10)).toMatchObject({ status: "reserve", points: 15 });
  expect(paceOf(0.5, 0)).toMatchObject({ status: "reserve", points: 50 });
  expect(paceOf(0.5, 125)).toMatchObject({ status: "deficit", points: 75 });
  expect(
    paceText({
      kind: "estimate",
      status: "deficit",
      points: 15,
      observedAt: now,
    }),
  ).toBe("Deficit by 15 percentage points");
});

it("requires 3% of the window elapsed at observation", () => {
  expect(paceOf(0.03, 3)).toMatchObject({ kind: "estimate" });
  expect(paceOf(0.029, 3)).toEqual({
    kind: "unavailable",
    reason: usagePaceMessages.early,
  });
});

it("evaluates at observedAt so a stale sample never improves as time passes", () => {
  const fresh = paceOf(0.25, 40);
  expect(paceOf(0.25, 40, now + 2 * 3600_000)).toEqual(fresh);
  expect(paceOf(0.25, 40, now + 0.75 * FIVE_HOURS)).toEqual({
    kind: "unavailable",
    reason: usagePaceMessages.resetSinceUpdate,
  });
});

it("keeps pacing unavailable for missing or unverifiable metadata", () => {
  const { window } = sample(0.5, 50);
  const reason = (value: Parameters<typeof usagePace>[0], at: number | null) =>
    (usagePace(value, at, now) as { reason?: string }).reason;
  expect(reason(window, null)).toBe(usagePaceMessages.noObservation);
  expect(reason({ ...window, kind: "custom" }, now)).toBe(
    usagePaceMessages.noDuration,
  );
  expect(reason({ ...window, kind: "daily" }, now)).toBe(
    usagePaceMessages.noDuration,
  );
  expect(reason({ ...window, resetsAt: null }, now)).toBe(
    usagePaceMessages.noReset,
  );
  expect(reason({ ...window, resetsAt: "not a date" }, now)).toBe(
    usagePaceMessages.noReset,
  );
  expect(reason({ ...window, usedPercent: null }, now)).toBe(
    usagePaceMessages.noUsage,
  );
  expect(
    reason({ ...window, resetsAt: new Date(now - 1).toISOString() }, now),
  ).toBe(usagePaceMessages.expired);
  expect(
    reason(
      { ...window, resetsAt: new Date(now + 2 * FIVE_HOURS).toISOString() },
      now,
    ),
  ).toBe(usagePaceMessages.mismatch);
});

it("applies the reset rule at its exact boundaries", () => {
  const window = { usedPercent: 40, resetsAt: new Date(now).toISOString() };
  expect(usageAllowance(window, now, now)).toMatchObject({ kind: "reported" });
  expect(usageAllowance(window, now - 1, now)).toEqual({
    kind: "reset-since-update",
  });
  expect(
    usageAllowance({ usedPercent: 40, resetsAt: "not a date" }, now - 1, now),
  ).toMatchObject({ kind: "reported", remainingPercent: 60 });
});

it("keeps the inclusive ±2 band despite floating-point error", () => {
  expect(paceOf(0.07, 5)).toMatchObject({ status: "on-pace" });
  expect(paceOf(0.29, 31)).toMatchObject({ status: "on-pace" });
  expect(paceOf(0.29, 31.01)).toMatchObject({ status: "deficit" });
  expect(paceOf(0.07, 4.99)).toMatchObject({ status: "reserve" });
  expect(
    paceText({
      kind: "estimate",
      status: "deficit",
      points: 2.04,
      observedAt: now,
    }),
  ).toBe("Deficit by 2.0 percentage points");
});

it.each([-1, 1.5, 9e15, Number.NaN])(
  "treats invalid measurement time %s as unavailable",
  (observedAt) => {
    const { window } = sample(0.5, 50);
    expect(usagePace(window, observedAt, now)).toEqual({
      kind: "unavailable",
      reason: usagePaceMessages.noObservation,
    });
    expect(freshnessText({ observedAt }, now)).toBe("Last update unavailable");
  },
);
