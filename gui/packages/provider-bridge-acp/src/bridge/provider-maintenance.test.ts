import { describe, expect, it } from "vitest";
import { CURSOR_ACP_MAINTENANCE, __testing } from "./provider-maintenance.js";

function cursorMissingInstallationStatus() {
  return {
    executableName: "cursor-agent",
    executablePath: null,
    installed: false,
    installSource: "notInstalled" as const,
    currentVersion: null,
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install" as const,
      label: "Install" as const,
      command: "install Cursor",
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("ACP provider maintenance", () => {
  it("normalizes Cursor plan and spend limits without reading daemon state", () => {
    expect(
      __testing.normalizeUsage(
        {
          billingCycleEnd: "1767225600000",
          planUsage: { totalPercentUsed: 112.5 },
          spendLimitUsage: {
            overallUsed: "1250",
            overallLimit: "5000",
          },
        },
        { planInfo: { planName: "Pro" } },
        "cursor@example.com",
      ),
    ).toEqual({
      status: "ok",
      accountEmail: "cursor@example.com",
      planLabel: "Pro",
      windows: [
        {
          label: "Plan usage",
          usedPercent: 100,
          reportedUsedPercent: 112.5,
          resetsAt: "2026-01-01T00:00:00.000Z",
        },
        {
          label: "On-demand spend",
          usedPercent: 25,
          reportedUsedPercent: 25,
          resetsAt: "2026-01-01T00:00:00.000Z",
          cost: { usedUsdCents: 1250, limitUsdCents: 5000 },
        },
      ],
    });
  });

  it("certifies Cursor raw usage only from present validated measurements", () => {
    const windows = (rawUsage: unknown) => {
      const usage = __testing.normalizeUsage(rawUsage, null);
      return usage.status === "ok"
        ? usage.windows.map(({ label, usedPercent, reportedUsedPercent }) => ({
            label,
            usedPercent,
            reportedUsedPercent,
          }))
        : usage.status;
    };
    expect(windows({})).toEqual([]);
    expect(windows({ planUsage: null })).toEqual([]);
    expect(windows({ planUsage: {} })).toEqual([]);
    expect(windows({ planUsage: { totalPercentUsed: null } })).toEqual([]);
    expect(windows({ spendLimitUsage: { overallLimit: "5000" } })).toEqual([]);
    expect(
      windows({
        spendLimitUsage: { individualLimit: 5000, individualUsed: null },
      }),
    ).toEqual([]);
    expect(windows({ planUsage: { totalPercentUsed: -1 } })).toBe("error");
    expect(windows({ planUsage: { totalPercentUsed: "50" } })).toBe("error");
    expect(windows({ planUsage: { totalPercentUsed: Infinity } })).toBe(
      "error",
    );
    expect(windows({ planUsage: { totalPercentUsed: Number.NaN } })).toBe(
      "error",
    );
    expect(
      windows({ spendLimitUsage: { overallLimit: 5000, overallUsed: -1 } }),
    ).toBe("error");
    for (const percent of [0, 100, 130]) {
      expect(
        windows({
          planUsage: { totalPercentUsed: percent },
          spendLimitUsage: {
            pooledLimit: 1000,
            pooledUsed: String(percent * 10),
          },
        }),
      ).toEqual([
        {
          label: "Plan usage",
          usedPercent: Math.min(percent, 100),
          reportedUsedPercent: percent,
        },
        {
          label: "On-demand spend",
          usedPercent: Math.min(percent, 100),
          reportedUsedPercent: percent,
        },
      ]);
    }
  });

  it("offers the installer only through a fresh matching action", () => {
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          installer: CURSOR_ACP_MAINTENANCE.installer,
          command: "cursor-agent",
          action: "install",
        },
      ),
    ).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(
      __testing.buildProviderInstallationRun(
        { ...cursorMissingInstallationStatus(), installAction: null },
        { installer: undefined, command: "opencode", action: "install" },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
    expect(
      __testing.buildProviderInstallationRun(
        cursorMissingInstallationStatus(),
        {
          installer: undefined,
          command: "opencode",
          action: "install",
        },
      ),
    ).toEqual({
      available: false,
      message: "opencode install is not available on this host.",
    });
  });
});
