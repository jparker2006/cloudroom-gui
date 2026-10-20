// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePendingAttachments } from "./pending-attachments";

function file(name: string, type = "", size = 3): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("usePendingAttachments", () => {
  it("tracks queued, uploading and failed files for the current draft only", () => {
    const { result, rerender } = renderHook(
      ({ targetKey }: { targetKey: string }) =>
        usePendingAttachments(targetKey),
      { initialProps: { targetKey: "draft-a" } },
    );

    let ids: string[] = [];
    act(() => {
      ids = result.current.queue("draft-a", [
        file("a.png", "image/png", 10),
        file("b.zip", "", 0),
      ]);
    });
    expect(result.current.pending.map((entry) => entry.status)).toEqual([
      "queued",
      "queued",
    ]);
    expect(result.current.pending[1]).toMatchObject({
      name: "b.zip",
      sizeBytes: 0,
    });
    expect(result.current.pending[1]).not.toHaveProperty("mimeType");

    act(() => {
      expect(result.current.start(ids[0]!)).toBe(true);
    });
    expect(result.current.pending[0]?.status).toBe("uploading");

    act(() => {
      expect(result.current.fail(ids[0]!, "Too big")).toBe(true);
    });
    expect(result.current.pending[0]).toMatchObject({
      status: "failed",
      error: "Too big",
    });

    rerender({ targetKey: "draft-b" });
    expect(result.current.pending).toEqual([]);
    rerender({ targetKey: "draft-a" });
    expect(result.current.pending).toHaveLength(2);
  });

  it("never reports a detached upload as attachable", () => {
    const { result } = renderHook(() => usePendingAttachments("draft"));
    let ids: string[] = [];
    act(() => {
      ids = result.current.queue("draft", [
        file("queued.txt"),
        file("in-flight.txt"),
        file("in-flight-fails.txt"),
      ]);
    });
    act(() => {
      result.current.start(ids[1]!);
      result.current.start(ids[2]!);
    });
    act(() => {
      result.current.dismiss(ids[0]!);
      result.current.dismiss(ids[1]!);
      result.current.dismiss(ids[2]!);
    });
    expect(result.current.pending).toEqual([]);

    let started = true;
    let attached = true;
    let failedRecorded = true;
    act(() => {
      started = result.current.start(ids[0]!);
      attached = result.current.settle(ids[1]!);
      failedRecorded = result.current.fail(ids[2]!, "Network");
    });
    expect(started).toBe(false);
    expect(attached).toBe(false);
    expect(failedRecorded).toBe(false);
    expect(result.current.pending).toEqual([]);
  });

  it("clears earlier failures for the same draft when a new batch starts", () => {
    const { result } = renderHook(() => usePendingAttachments("draft-a"));
    act(() => {
      const [aId] = result.current.queue("draft-a", [file("a.txt")]);
      const [bId] = result.current.queue("draft-b", [file("b.txt")]);
      result.current.fail(aId!, "x");
      result.current.fail(bId!, "y");
    });
    act(() => {
      result.current.queue("draft-a", [file("c.txt")]);
    });
    expect(result.current.pending.map((entry) => entry.name)).toEqual([
      "c.txt",
    ]);
  });
});
