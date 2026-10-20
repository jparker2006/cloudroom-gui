import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { releaseLocalAttachmentPreview } from "@/lib/attachment-local-previews";
import { usePendingAttachments } from "./pending-attachments";

interface UseNewThreadAttachmentUploadsArgs {
  projectId: string;
  storageKey: string;
  addAttachment: (attachment: PromptDraftAttachment) => void;
  setError: (error: string | null) => void;
}

export function useNewThreadAttachmentUploads({
  projectId,
  storageKey,
  addAttachment,
  setError,
}: UseNewThreadAttachmentUploadsArgs) {
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(false);
  const uploadPromptAttachment = useUploadPromptAttachment();
  const uploadTargetKey = `${projectId}\0${storageKey}`;
  const currentUploadTargetRef = useRef(uploadTargetKey);
  useEffect(() => {
    currentUploadTargetRef.current = uploadTargetKey;
  }, [uploadTargetKey]);
  const { pending, queue, start, settle, fail, dismiss } =
    usePendingAttachments(uploadTargetKey);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!projectId || files.length === 0 || isUploadingRef.current) return;
      const capturedTarget = `${projectId}\0${storageKey}`;
      setError(null);
      isUploadingRef.current = true;
      setIsUploading(true);
      const pendingIds = queue(capturedTarget, files);
      let nextIndex = 0;
      let failed = false;
      try {
        for (const file of files) {
          const pendingId = pendingIds[nextIndex++];
          if (pendingId === undefined || !start(pendingId)) continue;
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file,
            });
            const attached = settle(pendingId);
            if (
              !attached ||
              currentUploadTargetRef.current !== capturedTarget
            ) {
              releaseLocalAttachmentPreview(uploaded.path);
              if (currentUploadTargetRef.current !== capturedTarget) return;
            } else {
              const attachment = { ...uploaded, projectId };
              addAttachment(attachment);
            }
          } catch (error) {
            const message = getMutationErrorMessage({
              error,
              fallbackMessage: "Attachment upload failed",
            });
            if (
              fail(pendingId, message) &&
              currentUploadTargetRef.current === capturedTarget
            ) {
              setError(message);
            }
            failed = true;
            break;
          }
        }
      } finally {
        for (const pendingId of pendingIds.slice(nextIndex)) {
          if (failed) {
            fail(pendingId, "Not uploaded because an earlier file failed");
          } else {
            settle(pendingId);
          }
        }
        isUploadingRef.current = false;
        setIsUploading(false);
      }
    },
    [
      addAttachment,
      fail,
      projectId,
      queue,
      setError,
      settle,
      start,
      storageKey,
      uploadPromptAttachment,
    ],
  );

  return {
    handleAttachFiles,
    isUploading,
    isUploadingRef,
    pendingAttachments: pending,
    dismissPendingAttachment: dismiss,
  };
}
