import { useState } from "react";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import thumbnail from "../../../public/icon-512-teal.png?inline";
import { PromptBoxInternal } from "./PromptBoxInternal";
import { ExecutionControls } from "./ExecutionControls";
import type { AttachmentPreviewVariant } from "./AttachmentPreview";
import type { PendingAttachment } from "./pending-attachments";
import {
  makeAttachmentsConfig,
  makeExecutionControlsProps,
  makeTypeaheadConfig,
} from "../../../.ladle/story-fixtures";

export default { title: "promptbox/Attachment directions" };

const ready: PromptDraftAttachment[] = [
  {
    type: "localImage",
    path: thumbnail,
    name: "cloudroom-icon.png",
    mimeType: "image/png",
    sizeBytes: 62000,
  },
  {
    type: "localFile",
    path: "release-review-1.md",
    name: "release-review-and-attachment-acceptance-notes.md",
    mimeType: "text/markdown",
    sizeBytes: 0,
  },
  {
    type: "localFile",
    path: "assets-2.zip",
    name: "design-assets.zip",
    mimeType: "application/zip",
    sizeBytes: 3600000,
  },
  {
    type: "localFile",
    path: "reference-3.pdf",
    name: "reference.pdf",
    mimeType: "application/pdf",
    sizeBytes: 142000,
  },
  {
    type: "localFile",
    path: "metadata-4",
    name: "reference-without-metadata",
    sizeBytes: 0,
  },
];

const transient: PendingAttachment[] = [
  {
    id: "upload",
    name: "walkthrough.mp4",
    mimeType: "video/mp4",
    sizeBytes: 8400000,
    status: "uploading",
  },
  {
    id: "queue",
    name: "measurements.csv",
    mimeType: "text/csv",
    sizeBytes: 4800,
    status: "queued",
  },
  {
    id: "failure",
    name: "photo.heic",
    mimeType: "image/heic",
    sizeBytes: 2100000,
    status: "failed",
    error: "HEIC is not supported. Pick a PNG or JPEG.",
  },
];

function Direction({ variant }: { variant: AttachmentPreviewVariant }) {
  const [attachments, setAttachments] = useState(ready);
  const [pending, setPending] = useState(transient);
  const [value, setValue] = useState(
    "Review these attachments before we continue.",
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-8 max-md:gap-4 max-md:px-3 max-md:py-5">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Attachment tray · design choice
        </p>
        <h1 className="text-xl font-semibold">
          {variant === "rows"
            ? "A · Thumbnails + file chips"
            : "B · Consistent file cards"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {variant === "rows"
            ? "Images stay easy to spot. Files wrap into compact rows."
            : "Every attachment gets the same space. Swipe the tray on mobile."}
        </p>
      </header>
      <div className="flex-1 space-y-3 py-3">
        <p className="text-sm">The files are ready to review.</p>
        <p className="max-w-lg text-sm text-muted-foreground">
          One upload is in progress, one is queued, and one failed. Uploaded
          files stay available. Remove detaches a file from this draft.
        </p>
      </div>
      <div className="space-y-3">
        <PromptBoxInternal
          value={value}
          mentionRanges={[]}
          mentionMenuPlacement="top"
          onChange={setValue}
          onSubmit={() => {}}
          typeahead={makeTypeaheadConfig()}
          attachments={makeAttachmentsConfig({
            projectId: "attachment-demo",
            items: attachments,
            pending,
            trayVariant: variant,
            isAttaching: pending.some((entry) => entry.status !== "failed"),
            onRemove: (path) =>
              setAttachments((current) =>
                current.filter((entry) => entry.path !== path),
              ),
            onDismissPending: (id) =>
              setPending((current) =>
                current.filter((entry) => entry.id !== id),
              ),
          })}
          submission={{ isSubmitting: false, disabled: false, title: "Send" }}
          footerStart={<ExecutionControls {...makeExecutionControlsProps()} />}
        />
        <p className="text-xs text-muted-foreground">
          Try the image, unsupported ZIP preview, long filenames, and remove
          controls. File sizes are omitted when unknown.
        </p>
      </div>
    </main>
  );
}

export const ThumbnailsAndChips = () => <Direction variant="rows" />;
export const FileCards = () => <Direction variant="cards" />;
