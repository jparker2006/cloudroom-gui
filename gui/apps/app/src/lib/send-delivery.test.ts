import { describe, expect, it } from "vitest";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import type { TimelineRow } from "@cloudroom/server-contract";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
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
    expect(classifySendFailure(new TypeError("Failed to fetch"), false)).toBe("unconfirmed");
    expect(classifySendFailure(timeoutError(), false)).toBe("unconfirmed");
    expect(classifySendFailure(new HttpError({ status: 502, message: "Bad gateway" }), false)).toBe("unconfirmed");
    expect(classifySendFailure(new BbHttpError({ status: 504, message: "Gateway timeout", body: null, code: null }), false)).toBe("unconfirmed");
    expect(classifySendFailure(new BbHttpError({ status: 408, message: "Timeout", body: null, code: null }), false)).toBe("unconfirmed");
  });

  it("says not sent only when the browser was offline before the request left", () => {
    expect(classifySendFailure(new TypeError("Failed to fetch"), true)).toBe("not-sent");
    expect(classifySendFailure(new HttpError({ status: 502, message: "Bad gateway" }), true)).toBe("unconfirmed");
  });

  it("keeps structured server rejections on the existing rejection path", () => {
    expect(classifySendFailure(new BbHttpError({ status: 409, message: "Thread busy", body: null, code: "thread_not_writable" }), false)).toBe("rejected");
    expect(classifySendFailure(new BbHttpError({ status: 400, message: "Bad", body: null, code: null }), false)).toBe("rejected");
    expect(classifySendFailure(new BbHttpError({ status: 503, message: "Host unavailable", body: { code: "host_unavailable" }, code: "host_unavailable" }), false)).toBe("rejected");
  });

  it("leaves user cancellations alone", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifySendFailure(abort, false)).toBe("cancelled");
  });
});

function userRow(seq: number, text: string): TimelineRow {
  return conversationRow({ id: `row_${seq}`, role: "user", seq, text });
}

function queued(id: string, text: string): ThreadQueuedMessage {
  return makeThreadQueuedMessage({ id, content: [{ type: "text", text, mentions: [] }] });
}

const attempt = {
  text: "Please also add a CSV header row",
  baselineMaxSeq: 10,
  baselineQueueIds: ["q_old"],
  requestId: null as string | null,
};

describe("isMessageDelivered", () => {
  it("finds the message among rows that arrived after the send", () => {
    expect(isMessageDelivered(attempt, [userRow(11, "Please also add a  CSV header row\n")], [])).toBe(true);
  });

  it("ignores an identical message that was already in the conversation before sending", () => {
    expect(isMessageDelivered(attempt, [userRow(9, attempt.text)], [])).toBe(false);
  });

  it("finds a newly queued copy but not an older queued one", () => {
    expect(isMessageDelivered(attempt, [], [queued("q_old", attempt.text)])).toBe(false);
    expect(isMessageDelivered(attempt, [], [queued("q_new", attempt.text)])).toBe(true);
  });

  it("matches a cloud command by its request id", () => {
    expect(isMessageDelivered({ ...attempt, requestId: "req_1" }, [], [queued("req_1", "edited later")])).toBe(true);
  });

  it("cannot confirm without a pre-send baseline or any text to match", () => {
    expect(isMessageDelivered({ ...attempt, baselineMaxSeq: null }, [userRow(11, attempt.text)], [])).toBe(false);
    expect(isMessageDelivered({ ...attempt, text: "" }, [userRow(11, "")], [queued("q_new", "")])).toBe(false);
  });
});
