// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearNewThreadCloudroomRequest,
  newThreadCloudroomRequest,
} from "./cloudroom-queries";

const LEGACY_RECORD_KEY = "cloudroom-request:bb.promptbox.contents-draft-3";
const BETA_DRAFT_KEY = "bb.promptbox.contents-new-thread-proj_beta-3";
const BETA_RECORD_KEY = `cloudroom-request:${BETA_DRAFT_KEY}`;

async function fingerprintOf(input: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const request = { projectId: "proj_beta", prompt: "ship it" };

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("new-thread Cloud request evidence", () => {
  it("reuses an earlier ambiguous send's ID even when the draft holds an unrelated record", async () => {
    window.localStorage.setItem(LEGACY_RECORD_KEY, `${await fingerprintOf(request)}:legacy-id`);
    window.localStorage.setItem(BETA_RECORD_KEY, "0000:unrelated-id");

    const evidence = await newThreadCloudroomRequest(BETA_DRAFT_KEY, request);

    expect(evidence.id).toBe("legacy-id");
    expect(window.localStorage.getItem(BETA_RECORD_KEY)).toBe("0000:unrelated-id");
  });

  it("never overwrites an unmatched record when it issues a new ID", async () => {
    window.localStorage.setItem(BETA_RECORD_KEY, "0000:unrelated-id");

    const evidence = await newThreadCloudroomRequest(BETA_DRAFT_KEY, request);

    expect(evidence.id).not.toBe("unrelated-id");
    expect(window.localStorage.getItem(BETA_RECORD_KEY)).toBe("0000:unrelated-id");
    expect(window.localStorage.getItem(evidence.recordKey)).toBe(
      `${await fingerprintOf(request)}:${evidence.id}`,
    );
    expect(await newThreadCloudroomRequest(BETA_DRAFT_KEY, request)).toEqual(evidence);
  });

  it("clears only the record it used, and only while it still holds that request", async () => {
    window.localStorage.setItem(LEGACY_RECORD_KEY, `${await fingerprintOf(request)}:legacy-id`);
    const evidence = await newThreadCloudroomRequest(BETA_DRAFT_KEY, request);
    window.localStorage.setItem(LEGACY_RECORD_KEY, "1111:old-window-id");

    await clearNewThreadCloudroomRequest(evidence);
    expect(window.localStorage.getItem(LEGACY_RECORD_KEY)).toBe("1111:old-window-id");

    const fresh = await newThreadCloudroomRequest(BETA_DRAFT_KEY, { ...request, prompt: "again" });
    await clearNewThreadCloudroomRequest(fresh);
    expect(window.localStorage.getItem(fresh.recordKey)).toBeNull();
  });
});

describe("new-thread Cloud request evidence when the lock fails", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("still finds or issues an ID when the lock is refused", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException("timed out", "AbortError")) },
    });
    window.localStorage.setItem(LEGACY_RECORD_KEY, `${await fingerprintOf(request)}:legacy-id`);

    expect((await newThreadCloudroomRequest(BETA_DRAFT_KEY, request)).id).toBe("legacy-id");
  });

  it("never writes the shared record key when it runs without the lock", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException("timed out", "AbortError")) },
    });

    const evidence = await newThreadCloudroomRequest(BETA_DRAFT_KEY, request);

    expect(window.localStorage.getItem(BETA_RECORD_KEY)).toBeNull();
    expect(evidence.recordKey).toBe(`${BETA_RECORD_KEY}:${evidence.id}`);
  });
});

