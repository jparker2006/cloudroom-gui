import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  providerUsageResultSchema,
  providerUsageWindowSchema,
} from "../src/index.js";

const preRawPassthroughWindowSchema = z
  .object({
    label: z.string().min(1),
    usedPercent: z.number().min(0).max(100),
    resetsAt: z.string().min(1).nullable(),
  })
  .passthrough();

describe("provider usage window reportedUsedPercent", () => {
  const window = { label: "Weekly limit", usedPercent: 100, resetsAt: null };

  it("keeps the raw reported value next to the capped legacy value", () => {
    expect(
      providerUsageWindowSchema.parse({ ...window, reportedUsedPercent: 130 }),
    ).toMatchObject({ usedPercent: 100, reportedUsedPercent: 130 });
    expect(providerUsageWindowSchema.parse(window)).not.toHaveProperty(
      "reportedUsedPercent",
    );
    expect(
      providerUsageWindowSchema.parse({
        ...window,
        usedPercent: 0,
        reportedUsedPercent: 0,
      }),
    ).toMatchObject({ usedPercent: 0, reportedUsedPercent: 0 });
  });

  it("drops invalid raw values, keeps the capped reading and keeps it bounded", () => {
    for (const reportedUsedPercent of [null, "130", -1, Number.NaN, Infinity]) {
      const result = providerUsageResultSchema.parse({
        supported: true,
        usage: {
          status: "ok",
          accountEmail: null,
          planLabel: null,
          windows: [{ ...window, reportedUsedPercent }],
        },
      });
      const parsed =
        result.supported && result.usage.status === "ok"
          ? result.usage.windows[0]
          : null;
      expect(parsed?.usedPercent).toBe(100);
      expect(parsed?.reportedUsedPercent).toBeUndefined();
    }
    expect(
      providerUsageWindowSchema.safeParse({ ...window, usedPercent: 130 })
        .success,
    ).toBe(false);
  });

  it("survives a passthrough copy of the pre-raw window schema and the provider.usage result parse", () => {
    const current = { ...window, reportedUsedPercent: 130 };
    expect(preRawPassthroughWindowSchema.parse(current)).toMatchObject({
      reportedUsedPercent: 130,
    });
    const result = providerUsageResultSchema.parse({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [current],
      },
    });
    expect(result).toMatchObject({
      usage: { windows: [{ usedPercent: 100, reportedUsedPercent: 130 }] },
    });
  });
});
