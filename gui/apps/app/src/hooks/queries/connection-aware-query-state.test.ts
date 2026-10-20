import { describe, expect, it } from "vitest";
import {
  getConnectionAwareQueryState,
  type ConnectionAwareQueryStateArgs,
} from "./connection-aware-query-state";

const baseArgs: ConnectionAwareQueryStateArgs = {
  hasResolvedData: false,
  isFetching: false,
  isLoadingError: false,
  serverConnectionState: "connecting",
  connectionGracePeriodElapsed: false,
  loadingErrorGracePeriodElapsed: false,
};

describe("getConnectionAwareQueryState", () => {
  it("resolves loading, unavailable, and ready states from fetch and connection state", () => {
    const cases: ReadonlyArray<{
      args: ConnectionAwareQueryStateArgs;
      status: "loading" | "unavailable" | "ready";
    }> = [
      {
        args: { ...baseArgs, isFetching: true },
        status: "loading",
      },
      {
        args: {
          ...baseArgs,
          isLoadingError: true,
          serverConnectionState: "connecting",
          connectionGracePeriodElapsed: false,
        },
        status: "loading",
      },
      {
        args: {
          ...baseArgs,
          isLoadingError: true,
          serverConnectionState: "connecting",
          connectionGracePeriodElapsed: true,
        },
        status: "unavailable",
      },
      {
        args: {
          ...baseArgs,
          isLoadingError: true,
          serverConnectionState: "connected",
          connectionGracePeriodElapsed: false,
        },
        status: "unavailable",
      },
      {
        args: {
          ...baseArgs,
          isLoadingError: true,
          isRecoverableLoadingError: true,
          serverConnectionState: "connected",
          connectionGracePeriodElapsed: false,
        },
        status: "loading",
      },
      {
        args: {
          ...baseArgs,
          isLoadingError: true,
          isRecoverableLoadingError: true,
          serverConnectionState: "reconnecting",
          connectionGracePeriodElapsed: true,
        },
        status: "unavailable",
      },
      {
        args: {
          ...baseArgs,
          hasResolvedData: true,
          serverConnectionState: "connected",
        },
        status: "ready",
      },
    ];

    for (const testCase of cases) {
      expect(getConnectionAwareQueryState(testCase.args).status).toBe(
        testCase.status,
      );
    }
  });

  it("stops holding a failed first read as loading once its own grace period passes, even while connected", () => {
    const failedWhileConnected: ConnectionAwareQueryStateArgs = {
      ...baseArgs,
      isLoadingError: true,
      isRecoverableLoadingError: true,
      serverConnectionState: "connected",
    };
    expect(getConnectionAwareQueryState(failedWhileConnected).status).toBe(
      "loading",
    );
    expect(
      getConnectionAwareQueryState({
        ...failedWhileConnected,
        loadingErrorGracePeriodElapsed: true,
      }).status,
    ).toBe("unavailable");
    expect(
      getConnectionAwareQueryState({
        ...failedWhileConnected,
        isFetching: true,
        loadingErrorGracePeriodElapsed: true,
      }).status,
    ).toBe("loading");
  });
});
