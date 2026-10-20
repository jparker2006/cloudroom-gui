// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalAttachmentPreviews,
  getLocalAttachmentPreviewSrc,
  registerLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import type { InlineComposerDraftSession } from "./useActiveComposerDraft";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import { BbHttpError } from "@cloudroom/sdk/browser";
import { createDeferredPromise } from "@cloudroom/test-helpers";
import {
  useComposerAttachmentUploads,
  useDraftAttachmentUploads,
} from "./useComposerAttachmentUploads";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: mocks.upload }),
}));

function makeInlineSession(
  editSessionId: number,
  setDraft = vi.fn(),
): InlineComposerDraftSession {
  return { editSessionId, setDraft };
}

describe("useComposerAttachmentUploads", () => {
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

  it("keeps bottom and queued attachment operations independent", async () => {
    const bottomUpload = createDeferredPromise<never>();
    const inlineUpload = createDeferredPromise<never>();
    mocks.upload
      .mockReturnValueOnce(bottomUpload.promise)
      .mockReturnValueOnce(inlineUpload.promise);
    const inline = makeInlineSession(1);
    const inlineRef = { current: inline };
    const { result } = renderHook(() =>
      useComposerAttachmentUploads({
        projectId: "proj_1",
        draftStorageKey: "draft:thread_1",
        addDraftAttachment: vi.fn(),
        inlineEditSessionId: inline.editSessionId,
        inlineSessionRef: inlineRef,
      }),
    );

    let bottomPromise!: Promise<void>;
    act(() => {
      bottomPromise = result.current.handleAttachBottomFiles([
        new File(["bottom"], "bottom.txt"),
      ]);
    });
    expect(result.current.isAttachingBottomFiles).toBe(true);
    expect(result.current.isAttachingInlineFiles).toBe(false);

    let inlinePromise!: Promise<void>;
    act(() => {
      inlinePromise = result.current.handleAttachInlineFiles([
        new File(["inline"], "inline.txt"),
      ]);
    });
    expect(result.current.isAttachingBottomFiles).toBe(true);
    expect(result.current.isAttachingInlineFiles).toBe(true);

    await act(async () => {
      inlineUpload.reject(new Error("inline failed"));
      await inlinePromise;
    });
    expect(result.current.inlineAttachmentError).toBe(
      "Failed to attach: inline.txt",
    );
    expect(result.current.bottomAttachmentError).toBeNull();
    expect(result.current.isAttachingBottomFiles).toBe(true);

    await act(async () => {
      bottomUpload.reject(new Error("bottom failed"));
      await bottomPromise;
    });
    expect(result.current.bottomAttachmentError).toBe(
      "Failed to attach: bottom.txt",
    );
    expect(result.current.inlineAttachmentError).toBe(
      "Failed to attach: inline.txt",
    );
  });

  it("does not leak a dismissed upload into a later queued edit", async () => {
    const oldUpload = createDeferredPromise<never>();
    mocks.upload.mockReturnValueOnce(oldUpload.promise);
    const setDraft = vi.fn();
    const firstEdit = makeInlineSession(1, setDraft);
    const inlineRef: { current: InlineComposerDraftSession | null } = {
      current: firstEdit,
    };
    const { result, rerender } = renderHook(
      ({ inline }: { inline: InlineComposerDraftSession | null }) =>
        useComposerAttachmentUploads({
          projectId: "proj_1",
          draftStorageKey: "draft:thread_1",
          addDraftAttachment: vi.fn(),
          inlineEditSessionId: inline?.editSessionId ?? null,
          inlineSessionRef: inlineRef,
        }),
      {
        initialProps: {
          inline: firstEdit as InlineComposerDraftSession | null,
        },
      },
    );

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleAttachInlineFiles([
        new File(["old"], "old.txt"),
      ]);
    });
    expect(result.current.isAttachingInlineFiles).toBe(true);

    inlineRef.current = null;
    rerender({ inline: null });
    expect(result.current.isAttachingInlineFiles).toBe(false);
    expect(result.current.inlineAttachmentError).toBeNull();

    const secondEdit = makeInlineSession(2, setDraft);
    inlineRef.current = secondEdit;
    rerender({ inline: secondEdit });
    await act(async () => {
      oldUpload.reject(new Error("old failed"));
      await uploadPromise;
    });

    expect(result.current.isAttachingInlineFiles).toBe(false);
    expect(result.current.inlineAttachmentError).toBeNull();
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it refuses an upload", async () => {
    const message =
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.";
    mocks.upload
      .mockRejectedValueOnce(
        new BbHttpError({
          body: { code: "invalid_request", message },
          code: "invalid_request",
          message,
          status: 400,
        }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() =>
      useDraftAttachmentUploads({
        projectId: "proj_1",
        target: { key: "bottom", addAttachment: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.handleAttachFiles([
        new File(["heic"], "IMG_0001.heic", { type: "image/heic" }),
        new File(["png"], "shot.png", { type: "image/png" }),
      ]);
    });

    expect(result.current.attachmentError).toBe(
      `Failed to attach IMG_0001.heic, shot.png: ${message}`,
    );
  });

  it("does not leak a dismissed upload into a later independent draft", async () => {
    const oldUpload = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload.mockReturnValueOnce(oldUpload.promise);
    const addFirstAttachment = vi.fn();
    const addSecondAttachment = vi.fn();
    const { result, rerender } = renderHook(
      ({ target }) =>
        useDraftAttachmentUploads({
          projectId: "proj_1",
          target,
        }),
      {
        initialProps: {
          target: {
            key: "edit-1",
            addAttachment: addFirstAttachment,
          } as {
            key: string;
            addAttachment: (attachment: PromptDraftAttachment) => void;
          } | null,
        },
      },
    );

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleAttachFiles([
        new File(["old"], "old.txt"),
      ]);
    });
    expect(result.current.isAttachingFiles).toBe(true);

    rerender({ target: null });
    rerender({
      target: { key: "edit-2", addAttachment: addSecondAttachment },
    });
    await act(async () => {
      oldUpload.resolve({
        type: "localFile",
        path: "uploads/old.txt",
        name: "old.txt",
        sizeBytes: 3,
      });
      await uploadPromise;
    });

    expect(addFirstAttachment).not.toHaveBeenCalled();
    expect(addSecondAttachment).not.toHaveBeenCalled();
    expect(result.current.attachmentError).toBeNull();
    expect(result.current.isAttachingFiles).toBe(false);
  });

  it("keeps uploading after a failure and reports each file's state", async () => {
    const second = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(second.promise);
    const addAttachment = vi.fn();
    const { result } = renderHook(() =>
      useDraftAttachmentUploads({
        projectId: "proj_1",
        target: { key: "draft", addAttachment },
      }),
    );

    let batch!: Promise<void>;
    act(() => {
      batch = result.current.handleAttachFiles([
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.txt"),
      ]);
    });
    await act(async () => {});
    expect(
      result.current.pendingAttachments.map(({ name, status }) => ({
        name,
        status,
      })),
    ).toEqual([
      { name: "a.png", status: "failed" },
      { name: "b.txt", status: "uploading" },
    ]);
    expect(result.current.isAttachingFiles).toBe(true);

    await act(async () => {
      second.resolve({
        type: "localFile",
        path: "b-stored.txt",
        name: "b.txt",
        sizeBytes: 1,
      });
      await batch;
    });
    expect(addAttachment).toHaveBeenCalledTimes(1);
    expect(result.current.pendingAttachments).toEqual([
      expect.objectContaining({
        name: "a.png",
        status: "failed",
        error: "Upload failed",
      }),
    ]);
    expect(result.current.attachmentError).toBe("Failed to attach: a.png");
    expect(result.current.isAttachingFiles).toBe(false);
  });

  it("does not attach a file removed while it was uploading", async () => {
    const upload = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload.mockReturnValueOnce(upload.promise);
    const addAttachment = vi.fn();
    const { result } = renderHook(() =>
      useDraftAttachmentUploads({
        projectId: "proj_1",
        target: { key: "draft", addAttachment },
      }),
    );

    let batch!: Promise<void>;
    act(() => {
      batch = result.current.handleAttachFiles([new File(["a"], "a.txt")]);
    });
    act(() => {
      result.current.dismissPendingAttachment(
        result.current.pendingAttachments[0]!.id,
      );
    });
    expect(result.current.pendingAttachments).toEqual([]);
    await act(async () => {
      registerLocalAttachmentPreview(
        "a-stored.txt",
        new Blob(["image"], { type: "image/png" }),
      );
      upload.resolve({
        type: "localFile",
        path: "a-stored.txt",
        name: "a.txt",
        sizeBytes: 1,
      });
      await batch;
    });
    expect(addAttachment).not.toHaveBeenCalled();
    expect(getLocalAttachmentPreviewSrc("a-stored.txt")).toBeNull();
    expect(result.current.attachmentError).toBeNull();
  });

  it("does not attach an inline upload to another thread with the same edit session id", async () => {
    const upload = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload.mockReturnValueOnce(upload.promise);
    const setFirstDraft = vi.fn();
    const setSecondDraft = vi.fn();
    const inlineRef = { current: makeInlineSession(1, setFirstDraft) };
    const { result, rerender } = renderHook(
      ({ draftStorageKey }) =>
        useComposerAttachmentUploads({
          projectId: "proj_1",
          draftStorageKey,
          addDraftAttachment: vi.fn(),
          inlineEditSessionId: 1,
          inlineSessionRef: inlineRef,
        }),
      { initialProps: { draftStorageKey: "thread-a" } },
    );
    let batch!: Promise<void>;
    act(() => {
      batch = result.current.handleAttachInlineFiles([
        new File(["a"], "a.txt"),
      ]);
    });
    inlineRef.current = makeInlineSession(1, setSecondDraft);
    rerender({ draftStorageKey: "thread-b" });
    expect(result.current.inlinePendingAttachments).toEqual([]);
    await act(async () => {
      upload.resolve({
        type: "localFile",
        path: "stored-a.txt",
        name: "a.txt",
        sizeBytes: 1,
      });
      await batch;
    });
    expect(setFirstDraft).not.toHaveBeenCalled();
    expect(setSecondDraft).not.toHaveBeenCalled();
  });

  it("keeps a bottom upload in the draft that started it when the thread changes", async () => {
    const upload = createDeferredPromise<PromptDraftAttachment>();
    mocks.upload.mockReturnValueOnce(upload.promise);
    const addToThreadA = vi.fn();
    const addToThreadB = vi.fn();
    const inlineRef = { current: null };
    const { result, rerender } = renderHook(
      ({
        draftStorageKey,
        addDraftAttachment,
      }: {
        draftStorageKey: string;
        addDraftAttachment: (attachment: PromptDraftAttachment) => void;
      }) =>
        useComposerAttachmentUploads({
          projectId: "proj_1",
          draftStorageKey,
          addDraftAttachment,
          inlineEditSessionId: null,
          inlineSessionRef: inlineRef,
        }),
      {
        initialProps: {
          draftStorageKey: "draft:thread_a",
          addDraftAttachment: addToThreadA,
        },
      },
    );

    let batch!: Promise<void>;
    act(() => {
      batch = result.current.handleAttachBottomFiles([
        new File(["a"], "a.txt"),
      ]);
    });
    expect(result.current.bottomPendingAttachments).toHaveLength(1);

    rerender({
      draftStorageKey: "draft:thread_b",
      addDraftAttachment: addToThreadB,
    });
    expect(result.current.bottomPendingAttachments).toEqual([]);
    expect(result.current.isAttachingBottomFiles).toBe(false);

    await act(async () => {
      upload.resolve({
        type: "localFile",
        path: "a-stored.txt",
        name: "a.txt",
        sizeBytes: 1,
      });
      await batch;
    });
    expect(addToThreadB).not.toHaveBeenCalled();
    expect(addToThreadA).not.toHaveBeenCalled();
  });
});
