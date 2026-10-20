import { expect, it } from "vitest";
import { resetPassedText } from "./contract.js";

const now = Date.parse("2026-10-20T12:00:00.000Z");
const hour = 3600_000;

it("keeps a window's reported usage until its reset passes", () => {
  expect(resetPassedText({ resetsAt: now + hour }, now - hour, now)).toBeNull();
  expect(resetPassedText({ resetsAt: null }, now - hour, now)).toBeNull();
});

it("makes usage unavailable, not zero, once the reset passed after the measurement", () => {
  expect(resetPassedText({ resetsAt: now - hour }, now - 2 * hour, now)).toBe(
    "Reset since last update",
  );
  expect(resetPassedText({ resetsAt: now }, now - 1, now)).toBe(
    "Reset since last update",
  );
});

it("does not claim a last update when the measurement time is unknown", () => {
  expect(resetPassedText({ resetsAt: now - hour }, null, now)).toBe(
    "Reset passed, current usage unknown",
  );
});

it("keeps usage measured after the reset", () => {
  expect(resetPassedText({ resetsAt: now - hour }, now - 1, now)).toBeNull();
});
