import { describe, expect, it } from "vitest";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import { makeThreadQueuedMessage } from "@cloudroom/test-helpers/domain-fixtures";
import { BbHttpError } from "@/lib/sdk";
import { HttpError } from "./api";
import { classifySendFailure, isMessageDelivered } from "./send-delivery";

function timeoutError(): Error {
  const error = new Error("The operation timed out.");
  error.name = "TimeoutError";
  return error;
}

describe("classifySendFailure", () => {
  it("never calls a lost answer a failure", () => {
    expect(classifySendFailure(new TypeError("Failed to fetch"))).toBe("unconfirmed");
    expect(classifySendFailure(timeoutError())).toBe("unconfirmed");
    expect(classifySendFailure(new HttpError({ status: 502, message: "Bad gateway" }))).toBe("unconfirmed");
    expect(classifySendFailure(new BbHttpError({ status: 504, message: "Gateway timeout", body: null, code: null }))).toBe("unconfirmed");
    expect(classifySendFailure(new BbHttpError({ status: 408, message: "Timeout", body: null, code: null }))).toBe("unconfirmed");
  });

  it("never treats the browser offline flag as proof the request did not leave", () => {
    expect(classifySendFailure(new TypeError("Failed to fetch"))).toBe("unconfirmed");
  });

  it("keeps structured server rejections on the existing rejection path", () => {
    expect(classifySendFailure(new BbHttpError({ status: 409, message: "Thread busy", body: null, code: "thread_not_writable" }))).toBe("rejected");
    expect(classifySendFailure(new BbHttpError({ status: 400, message: "Bad", body: null, code: null }))).toBe("rejected");
    expect(classifySendFailure(new BbHttpError({ status: 503, message: "Host unavailable", body: { code: "host_unavailable" }, code: "host_unavailable" }))).toBe("rejected");
  });

  it("leaves user cancellations alone", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifySendFailure(abort)).toBe("cancelled");
  });
});

function queued(id: string, text: string): ThreadQueuedMessage {
  return makeThreadQueuedMessage({ id, content: [{ type: "text", text, mentions: [] }] });
}

describe("isMessageDelivered", () => {
  it("confirms only the exact queued request id", () => {
    expect(isMessageDelivered({ requestId: "req_1" }, [queued("req_1", "edited later")])).toBe(true);
    expect(isMessageDelivered({ requestId: "req_1" }, [queued("req_other", "same text")])).toBe(false);
  });

  it("never confirms without a request id, whatever the text", () => {
    expect(isMessageDelivered({ requestId: null }, [queued("q_new", "Please also add a CSV header row")])).toBe(false);
  });
});
