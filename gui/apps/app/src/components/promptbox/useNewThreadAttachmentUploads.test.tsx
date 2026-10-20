// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalAttachmentPreviews,
  getLocalAttachmentPreviewSrc,
  registerLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import { createDeferredPromise } from "@cloudroom/test-helpers";
import { useNewThreadAttachmentUploads } from "./useNewThreadAttachmentUploads";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: mocks.upload }),
}));

function uploaded(name: string): PromptDraftAttachment {
  return { type: "localFile", path: `${name}-stored`, name, sizeBytes: 3 };
}

describe("useNewThreadAttachmentUploads", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:late-upload";
        static revokeObjectURL = vi.fn();
      },
    );
  });

  afterEach(() => {
    clearLocalAttachmentPreviews();
    vi.unstubAllGlobals();
  });

  it("preserves upload provenance and an opaque copy token before adding to the draft", async () => {
    const attachment = {
      ...uploaded("photo.png"),
      copyToken: "opaque-copy-token",
    };
    mocks.upload.mockResolvedValueOnce(attachment);
    const addAttachment = vi.fn();
    const { result } = renderHook(() =>
      useNewThreadAttachmentUploads({
        projectId: "source-project",
        storageKey: "new-thread",
        addAttachment,
        setError: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.handleAttachFiles([
        new File(["png"], "photo.png", { type: "image/png" }),
      ]);
    });
    expect(addAttachment).toHaveBeenCalledWith({
      ...attachment,
      projectId: "source-project",
    });
  });

  it("stops at the first failure and marks the skipped files as failed", async () => {
    mocks.upload
      .mockResolvedValueOnce(uploaded("one.txt"))
      .mockRejectedValueOnce(new Error("boom"));
    const addAttachment = vi.fn();
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useNewThreadAttachmentUploads({
        projectId: "proj_1",
        storageKey: "new-thread",
        addAttachment,
        setError,
      }),
    );

    await act(async () => {
      await result.current.handleAttachFiles([
        new File(["1"], "one.txt"),
        new File(["2"], "two.txt"),
        new File(["3"], "three.txt"),
      ]);
    });

    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenCalledWith({
      ...uploaded("one.txt"),
      projectId: "proj_1",
    });
    expect(setError).toHaveBeenLastCalledWith("boom");
    expect(
      result.current.pendingAttachments.map(({ name, status, error }) => ({
        name,
        status,
        error,
      })),
    ).toEqual([
      { name: "two.txt", status: "failed", error: "boom" },
      {
        name: "three.txt",
        status: "failed",
        error: "Not uploaded because an earlier file failed",
      },
    ]);
    expect(result.current.isUploading).toBe(false);
  });

  it("ignores a second batch while one is uploading", async () => {
    const first = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() =>
      useNewThreadAttachmentUploads({
        projectId: "proj_1",
        storageKey: "new-thread",
        addAttachment: vi.fn(),
        setError: vi.fn(),
      }),
    );

    let firstBatch!: Promise<void>;
    act(() => {
      firstBatch = result.current.handleAttachFiles([new File(["1"], "a.txt")]);
    });
    await act(async () => {
      await result.current.handleAttachFiles([new File(["2"], "b.txt")]);
    });
    expect(
      result.current.pendingAttachments.map((entry) => entry.name),
    ).toEqual(["a.txt"]);
    expect(result.current.pendingAttachments[0]?.status).toBe("uploading");

    await act(async () => {
      first.resolve(uploaded("a.txt"));
      await firstBatch;
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(result.current.pendingAttachments).toEqual([]);
  });

  it("does not attach an upload removed while in flight or after the draft changes", async () => {
    const removed = createDeferredPromise<PromptDraftAttachment>();
    const switched = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload
      .mockReturnValueOnce(removed.promise)
      .mockReturnValueOnce(switched.promise);
    const addAttachment = vi.fn();
    const { result, rerender } = renderHook(
      ({ storageKey }: { storageKey: string }) =>
        useNewThreadAttachmentUploads({
          projectId: "proj_1",
          storageKey,
          addAttachment,
          setError: vi.fn(),
        }),
      { initialProps: { storageKey: "draft-a" } },
    );

    let batch!: Promise<void>;
    act(() => {
      batch = result.current.handleAttachFiles([new File(["1"], "gone.txt")]);
    });
    act(() => {
      result.current.dismissPendingAttachment(
        result.current.pendingAttachments[0]!.id,
      );
    });
    await act(async () => {
      registerLocalAttachmentPreview(
        "gone.txt-stored",
        new Blob(["image"], { type: "image/png" }),
      );
      removed.resolve(uploaded("gone.txt"));
      await batch;
    });
    expect(addAttachment).not.toHaveBeenCalled();
    expect(getLocalAttachmentPreviewSrc("gone.txt-stored")).toBeNull();

    act(() => {
      batch = result.current.handleAttachFiles([
        new File(["2"], "late.txt"),
        new File(["3"], "never.txt"),
      ]);
    });
    rerender({ storageKey: "draft-b" });
    await act(async () => {
      registerLocalAttachmentPreview(
        "late.txt-stored",
        new Blob(["image"], { type: "image/png" }),
      );
      switched.resolve(uploaded("late.txt"));
      await batch;
    });
    expect(addAttachment).not.toHaveBeenCalled();
    expect(getLocalAttachmentPreviewSrc("late.txt-stored")).toBeNull();
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    rerender({ storageKey: "draft-a" });
    expect(result.current.pendingAttachments).toEqual([]);
  });
});
