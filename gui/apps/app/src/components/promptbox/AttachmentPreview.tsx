import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox.js";
import { Icon, type IconName } from "@cloudroom/shared-ui/icon";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  getProjectStoredPromptAttachmentPaths,
  type PromptDraftAttachment,
} from "@cloudroom/client-core";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { buildProjectAttachmentContentUrl } from "@/lib/file-content-urls";
import {
  getLocalAttachmentPreviewSrc,
  releaseLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import type {
  PendingAttachment,
  PendingAttachmentStatus,
} from "./pending-attachments";

const AttachmentFilePreview = lazy(() => import("./AttachmentFilePreview"));

export function resolveAttachmentPreviewSrc(
  path: string,
  attachmentProjectId: string | undefined,
): string {
  return (
    getLocalAttachmentPreviewSrc(path) ??
    toUserAttachmentImageSrc(path, attachmentProjectId)
  );
}

const FILE_TYPES: Array<[RegExp, IconName, string]> = [
  [/^pdf$/, "FileText", "text-red-400"],
  [/^(xlsx?|csv|tsv|numbers|ods)$/, "FileSpreadsheet", "text-emerald-400"],
  [/^(zip|tar|gz|tgz|rar|7z|bz2|xz)$/, "FileZip", "text-amber-400"],
  [/^(docx?|rtf|pages|odt|pptx?|key)$/, "FileText", "text-sky-400"],
  [/^(mp3|wav|m4a|aac|flac|ogg)$/, "FileAudio", "text-pink-400"],
  [/^(mp4|mov|webm|mkv|avi)$/, "FileVideo", "text-pink-400"],
  [
    /^(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|zsh|sql|json|ya?ml|toml|xml|html?|css|scss|vue|svelte)$/,
    "FileCode",
    "text-violet-400",
  ],
];

const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  "txt",
  "log",
  "ini",
  "md",
  "markdown",
  "yaml",
  "yml",
  "json",
  "js",
  "mjs",
  "jsx",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "css",
  "scss",
  "ts",
  "tsx",
  "py",
  "sh",
  "sql",
  "toml",
  "xml",
  "csv",
  "tsv",
  "patch",
  "diff",
  "pdf",
]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function AttachmentFileIcon({ name }: { name: string }) {
  const extension = fileExtension(name);
  const match = FILE_TYPES.find(([pattern]) => pattern.test(extension));
  return (
    <Icon
      name={match?.[1] ?? "FileText"}
      className={`size-4 shrink-0 ${match?.[2] ?? "text-muted-foreground"}`}
    />
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(name: string, mimeType: string | undefined): string {
  const extension = fileExtension(name);
  if (extension.length > 0 && extension.length <= 5) {
    return extension.toUpperCase();
  }
  const subtype = mimeType?.split("/")[1]?.split(/[;+]/u)[0] ?? "";
  return /^[a-z0-9]{1,5}$/iu.test(subtype) ? subtype.toUpperCase() : "";
}

function isImageAttachment(attachment: PromptDraftAttachment): boolean {
  return (
    attachment.type === "localImage" ||
    attachment.mimeType?.toLowerCase().startsWith("image/") === true
  );
}

type TrayItemStatus = "ready" | PendingAttachmentStatus;

type OwnedDraftAttachment = PromptDraftAttachment & { projectId?: string };

type TrayInspect =
  | { kind: "image"; index: number }
  | { kind: "link"; href: string }
  | { kind: "file"; href: string }
  | { kind: "notice"; message: string; resourceSrc?: string | null }
  | null;

interface TrayItem {
  key: string;
  name: string;
  isImage: boolean;
  thumbnailSrc: string | null;
  status: TrayItemStatus;
  detail: string;
  error?: string;
  inspect: TrayInspect;
  onRemove: (() => void) | null;
  removeLabel: string;
}

const STATUS_LABELS: Record<PendingAttachmentStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  failed: "Failed",
};

function describeUnsupportedPreview(name: string, typeLabel: string): string {
  return typeLabel.length > 0
    ? `Preview not available for ${typeLabel} files. ${name} is still attached.`
    : `Preview not available for this file type. ${name} is still attached.`;
}

function fileInspect(
  attachment: PromptDraftAttachment,
  projectId: string | undefined,
  typeLabel: string,
): TrayInspect {
  const isProjectAttachment =
    projectId !== undefined &&
    getProjectStoredPromptAttachmentPaths([attachment]).length > 0;
  if (!isProjectAttachment) {
    return {
      kind: "notice",
      message: `Preview not available for files outside this project's attachments. ${attachment.name} is still attached.`,
    };
  }
  if (!BROWSER_PREVIEWABLE_EXTENSIONS.has(fileExtension(attachment.path))) {
    return {
      kind: "notice",
      message: describeUnsupportedPreview(attachment.name, typeLabel),
    };
  }
  return {
    kind: fileExtension(attachment.path) === "pdf" ? "link" : "file",
    href: buildProjectAttachmentContentUrl(projectId, attachment.path),
  };
}

interface BuildTrayItemsArgs {
  attachments: readonly OwnedDraftAttachment[];
  pending: readonly PendingAttachment[];
  projectId: string | undefined;
  brokenThumbnails: ReadonlySet<string>;
  onRemoveAttachment: ((path: string) => void) | undefined;
  onDismissPending: ((id: string) => void) | undefined;
}

function buildTrayItems({
  attachments,
  pending,
  projectId,
  brokenThumbnails,
  onRemoveAttachment,
  onDismissPending,
}: BuildTrayItemsArgs): { items: TrayItem[]; lightboxItems: TrayItem[] } {
  const lightboxItems: TrayItem[] = [];
  const items: TrayItem[] = attachments.map((attachment) => {
    const ownerProjectId = attachment.projectId ?? projectId;
    const isImage = isImageAttachment(attachment);
    const typeLabel = fileTypeLabel(attachment.name, attachment.mimeType);
    const detail = [
      typeLabel,
      attachment.sizeBytes > 0 ? formatFileSize(attachment.sizeBytes) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const thumbnailSrc = isImage
      ? resolveAttachmentPreviewSrc(attachment.path, ownerProjectId)
      : null;
    const thumbnailBroken =
      thumbnailSrc !== null && brokenThumbnails.has(thumbnailSrc);
    const item: TrayItem = {
      key: `attachment:${attachment.path}`,
      name: attachment.name,
      isImage,
      thumbnailSrc: thumbnailBroken ? null : thumbnailSrc,
      status: "ready",
      detail,
      inspect: isImage
        ? thumbnailBroken
          ? {
              kind: "notice",
              message: `Couldn't load a preview of ${attachment.name}. It is still attached.`,
              resourceSrc: thumbnailSrc,
            }
          : { kind: "image", index: lightboxItems.length }
        : fileInspect(attachment, ownerProjectId, typeLabel),
      onRemove: onRemoveAttachment
        ? () => {
            if (isImage) releaseLocalAttachmentPreview(attachment.path);
            onRemoveAttachment(attachment.path);
          }
        : null,
      removeLabel: `Remove ${attachment.name}`,
    };
    if (item.inspect?.kind === "image") lightboxItems.push(item);
    return item;
  });
  for (const entry of pending) {
    const isImage = entry.mimeType?.toLowerCase().startsWith("image/") === true;
    items.push({
      key: `pending:${entry.id}`,
      name: entry.name,
      isImage,
      thumbnailSrc: null,
      status: entry.status,
      detail: [
        fileTypeLabel(entry.name, entry.mimeType),
        formatFileSize(entry.sizeBytes),
      ]
        .filter(Boolean)
        .join(" · "),
      ...(entry.error === undefined ? {} : { error: entry.error }),
      inspect: null,
      onRemove: onDismissPending ? () => onDismissPending(entry.id) : null,
      removeLabel:
        entry.status === "failed"
          ? `Dismiss failed upload ${entry.name}`
          : `Remove ${entry.name}`,
    });
  }
  return { items, lightboxItems };
}

function statusText(item: TrayItem): string {
  return item.status === "ready" ? item.detail : STATUS_LABELS[item.status];
}

function accessibleItemLabel(item: TrayItem): string {
  const parts = [item.name];
  if (item.status !== "ready") parts.push(STATUS_LABELS[item.status]);
  if (item.error) parts.push(item.error);
  if (item.detail) parts.push(item.detail);
  return parts.join(", ");
}

function summarizePending(pending: readonly PendingAttachment[]): string {
  const counts = { queued: 0, uploading: 0, failed: 0 };
  for (const entry of pending) counts[entry.status] += 1;
  return [
    counts.uploading > 0 ? `${counts.uploading} uploading` : "",
    counts.queued > 0 ? `${counts.queued} queued` : "",
    counts.failed > 0
      ? `${counts.failed} failed: ${pending
          .filter((entry) => entry.status === "failed")
          .map((entry) => entry.name)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function StatusIcon({ status }: { status: TrayItemStatus }) {
  if (status === "uploading") {
    return (
      <Icon
        name="Spinner"
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  if (status === "queued") {
    return (
      <Icon name="Spinner" className="size-4 shrink-0 text-subtle-foreground" />
    );
  }
  if (status === "failed") {
    return (
      <Icon
        name="AlertCircle"
        className="size-4 shrink-0 text-destructive-text"
      />
    );
  }
  return null;
}

export type AttachmentPreviewVariant = "rows" | "cards";

interface AttachmentPreviewProps {
  attachments: OwnedDraftAttachment[];
  pending?: readonly PendingAttachment[];
  compact?: boolean;
  variant?: AttachmentPreviewVariant;
  attachmentProjectId?: string;
  expandedImageIndex: number | null;
  onExpandedImageIndexChange: (index: number | null) => void;
  onRemoveAttachment?: (path: string) => void;
  onDismissPending?: (id: string) => void;
  onRestoreEditorFocus?: (viaKeyboard: boolean) => void;
}

export function AttachmentPreview({
  attachments,
  pending = [],
  compact = false,
  variant = "rows",
  attachmentProjectId,
  expandedImageIndex,
  onExpandedImageIndexChange,
  onRemoveAttachment,
  onDismissPending,
  onRestoreEditorFocus,
}: AttachmentPreviewProps) {
  const trayRef = useRef<HTMLDivElement>(null);
  const noticeId = useId();
  const [brokenThumbnails, setBrokenThumbnails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<{
    key: string;
    message: string;
    resourceSrc?: string | null;
  } | null>(null);
  const [inspectedFileKey, setInspectedFileKey] = useState<string | null>(null);
  const { items, lightboxItems } = buildTrayItems({
    attachments,
    pending,
    projectId: attachmentProjectId,
    brokenThumbnails,
    onRemoveAttachment,
    onDismissPending,
  });
  const currentLightboxItem =
    expandedImageIndex !== null
      ? (lightboxItems[expandedImageIndex] ?? null)
      : null;
  const visibleNotice =
    notice !== null &&
    items.some(
      (item) =>
        item.key === notice.key &&
        item.inspect?.kind === "notice" &&
        item.inspect.resourceSrc === notice.resourceSrc,
    )
      ? notice
      : null;
  const pendingSummary = summarizePending(pending);
  const inspectedFile = items.find((item) => item.key === inspectedFileKey);

  useEffect(() => {
    if (expandedImageIndex === null) return;
    if (expandedImageIndex < lightboxItems.length) return;
    onExpandedImageIndexChange(null);
  }, [expandedImageIndex, lightboxItems.length, onExpandedImageIndexChange]);

  if (items.length === 0) {
    return null;
  }

  const markThumbnailBroken = (item: TrayItem) => {
    const thumbnailSrc = item.thumbnailSrc;
    if (thumbnailSrc === null) return;
    setBrokenThumbnails((current) => new Set(current).add(thumbnailSrc));
  };

  const removeItem = (item: TrayItem, viaKeyboard: boolean) => {
    if (!item.onRemove) return;
    const wrappers = Array.from(
      trayRef.current?.querySelectorAll<HTMLElement>(
        "[data-attachment-item]",
      ) ?? [],
    );
    const ownIndex = wrappers.findIndex(
      (wrapper) => wrapper.dataset.attachmentItem === item.key,
    );
    const neighborWrapper = viaKeyboard
      ? (wrappers[ownIndex + 1] ?? wrappers[ownIndex - 1] ?? null)
      : null;
    const neighbor =
      neighborWrapper?.querySelector<HTMLElement>("a[href], button") ?? null;
    if (notice?.key === item.key) setNotice(null);
    item.onRemove();
    if (neighbor) {
      requestAnimationFrame(() => {
        if (neighbor.isConnected) neighbor.focus();
        else onRestoreEditorFocus?.(true);
      });
    } else {
      onRestoreEditorFocus?.(viaKeyboard);
    }
  };

  const handleRemoveClick = (
    item: TrayItem,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const viaKeyboard = event.detail === 0;
    if (!viaKeyboard) event.currentTarget.blur();
    removeItem(item, viaKeyboard);
  };

  const handleInspectKeyDown = (
    item: TrayItem,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!item.onRemove) return;
    event.preventDefault();
    removeItem(item, true);
  };

  const inspectItem = (item: TrayItem) => {
    setInspectedFileKey(item.inspect?.kind === "file" ? item.key : null);
    if (item.inspect?.kind === "image") {
      setNotice(null);
      onExpandedImageIndexChange(item.inspect.index);
    } else if (item.inspect?.kind === "notice") {
      setNotice({
        key: item.key,
        message: item.inspect.message,
        resourceSrc: item.inspect.resourceSrc,
      });
    } else {
      setNotice(null);
    }
  };

  const renderInspect = (
    item: TrayItem,
    className: string,
    children: ReactNode,
  ) => {
    const label = accessibleItemLabel(item);
    if (item.inspect === null) {
      return (
        <span
          role="group"
          aria-label={label}
          title={item.error ? `${item.name}: ${item.error}` : item.name}
          className={className}
        >
          {children}
        </span>
      );
    }
    if (item.inspect.kind === "link") {
      return (
        <a
          href={item.inspect.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${label} in a new tab`}
          title={item.name}
          className={cn(className, "cursor-pointer hover:bg-state-hover")}
          onClick={() => setNotice(null)}
          onKeyDown={(event) => handleInspectKeyDown(item, event)}
        >
          {children}
        </a>
      );
    }
    return (
      <button
        type="button"
        aria-label={
          item.inspect.kind === "image" || item.inspect.kind === "file"
            ? `Preview ${label}`
            : label
        }
        aria-describedby={
          visibleNotice?.key === item.key ? noticeId : undefined
        }
        title={item.name}
        className={cn(
          className,
          item.inspect.kind === "image"
            ? "cursor-zoom-in"
            : item.inspect.kind === "file"
              ? "cursor-pointer hover:bg-state-hover"
              : "cursor-help",
        )}
        onClick={() => inspectItem(item)}
        onKeyDown={(event) => handleInspectKeyDown(item, event)}
      >
        {children}
      </button>
    );
  };

  const renderThumbnail = (item: TrayItem, className: string) =>
    item.thumbnailSrc ? (
      <img
        src={item.thumbnailSrc}
        alt={item.name}
        className={cn("object-cover", className)}
        loading="lazy"
        decoding="async"
        onError={() => markThumbnailBroken(item)}
      />
    ) : null;

  const renderRemove = (item: TrayItem, overlay: boolean) =>
    item.onRemove ? (
      <button
        type="button"
        onClick={(event) => handleRemoveClick(item, event)}
        className={
          overlay
            ? "group/attachment-remove-image absolute right-1 top-1 z-10 inline-flex size-4 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:-right-1 max-md:pointer-coarse:-top-1 max-md:pointer-coarse:size-7"
            : "group/attachment-remove-file absolute left-1/2 top-1/2 inline-flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:size-7"
        }
        aria-label={item.removeLabel}
      >
        {overlay ? (
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-black/55 transition-colors group-hover/attachment-remove-image:bg-black/70">
            <Icon name="X" className="size-3" />
          </span>
        ) : (
          <span className="inline-flex size-4 items-center justify-center rounded transition-colors group-hover/attachment-remove-file:bg-state-hover">
            <Icon name="X" className="size-3" />
          </span>
        )}
      </button>
    ) : null;

  const renderRowsImage = (item: TrayItem) => (
    <div
      key={item.key}
      data-attachment-item={item.key}
      className="relative w-24"
    >
      {renderInspect(
        item,
        cn(
          "flex h-16 w-24 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-surface-recessed px-1.5 text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          item.status === "failed"
            ? "border-surface-destructive-border"
            : "border-border",
        ),
        item.thumbnailSrc ? (
          renderThumbnail(item, "h-16 w-24")
        ) : (
          <>
            {item.status === "ready" ? (
              <Icon name="Image" className="size-4 shrink-0" />
            ) : (
              <StatusIcon status={item.status} />
            )}
            <span className="w-full truncate text-center text-[11px] leading-tight text-foreground">
              {item.name}
            </span>
            <span
              className={cn(
                "w-full truncate text-center text-[10px] leading-tight",
                item.status === "failed"
                  ? "text-destructive-text"
                  : "text-subtle-foreground",
              )}
            >
              {item.status === "ready"
                ? "No preview"
                : STATUS_LABELS[item.status]}
            </span>
          </>
        ),
      )}
      {renderRemove(item, true)}
      {item.thumbnailSrc ? (
        <div
          className="mt-1 text-[10px] leading-3.5 text-muted-foreground"
          title={accessibleItemLabel(item)}
        >
          <p className="truncate">{item.name}</p>
          {item.detail ? (
            <p className="truncate text-subtle-foreground">{item.detail}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderRowsFile = (item: TrayItem) => (
    <span
      key={item.key}
      data-attachment-item={item.key}
      className={cn(
        "relative inline-flex h-7 max-w-full items-center rounded-lg border bg-surface-recessed pr-1.5 text-xs text-foreground",
        item.status === "failed"
          ? "border-surface-destructive-border"
          : "border-foreground/10",
      )}
    >
      {renderInspect(
        item,
        "inline-flex h-full min-w-0 items-center gap-1.5 rounded-l-lg pl-2 pr-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        <>
          {item.status === "ready" ? (
            <AttachmentFileIcon name={item.name} />
          ) : (
            <StatusIcon status={item.status} />
          )}
          <span className="min-w-0 truncate">{item.name}</span>
          {statusText(item) ? (
            <span
              className={cn(
                "shrink-0",
                item.status === "failed"
                  ? "text-destructive-text"
                  : "text-subtle-foreground",
              )}
            >
              {statusText(item)}
            </span>
          ) : null}
        </>,
      )}
      {item.onRemove ? (
        <span className="relative size-4 shrink-0">
          {renderRemove(item, false)}
        </span>
      ) : null}
    </span>
  );

  const renderCard = (item: TrayItem) => (
    <div
      key={item.key}
      data-attachment-item={item.key}
      className={cn(
        "relative flex h-12 w-52 shrink-0 snap-start items-center rounded-lg border bg-surface-recessed max-md:w-48",
        item.status === "failed"
          ? "border-surface-destructive-border"
          : "border-foreground/10",
      )}
    >
      {renderInspect(
        item,
        "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg p-1 pr-6 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        <>
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-raised">
            {item.thumbnailSrc ? (
              renderThumbnail(item, "size-10")
            ) : item.status === "ready" ? (
              item.isImage ? (
                <Icon name="Image" className="size-4 text-muted-foreground" />
              ) : (
                <AttachmentFileIcon name={item.name} />
              )
            ) : (
              <StatusIcon status={item.status} />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs text-foreground">
              {item.name}
            </span>
            <span
              className={cn(
                "truncate text-[11px] leading-4",
                item.status === "failed"
                  ? "text-destructive-text"
                  : "text-subtle-foreground",
              )}
            >
              {item.status === "failed" && item.error
                ? item.error
                : statusText(item) ||
                  (item.status === "ready" ? "Attached" : "")}
            </span>
          </span>
        </>,
      )}
      {item.onRemove ? (
        <span className="absolute right-1 top-1 size-4">
          {renderRemove(item, false)}
        </span>
      ) : null}
    </div>
  );

  const imageItems = items.filter((item) => item.isImage);
  const fileItems = items.filter((item) => !item.isImage);

  return (
    <>
      {compact ? (
        <span
          data-promptbox-attachments=""
          role="img"
          aria-label={[
            `${items.length} ${items.length === 1 ? "attachment" : "attachments"}`,
            pendingSummary,
          ]
            .filter(Boolean)
            .join(", ")}
          className="ml-3 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-surface-recessed px-2 text-xs text-muted-foreground"
        >
          {pending.some((entry) => entry.status === "failed") ? (
            <Icon
              name="AlertCircle"
              className="size-3.5 text-destructive-text"
            />
          ) : pending.length > 0 ? (
            <Icon name="Spinner" className="size-3.5 animate-spin" />
          ) : (
            <Icon name="Paperclip" className="size-3.5" />
          )}
          <span aria-hidden="true">{items.length}</span>
        </span>
      ) : (
        <div ref={trayRef} className="mx-3 mb-1 mt-1">
          {variant === "cards" ? (
            <div className="flex flex-wrap gap-2 max-md:-mx-3 max-md:flex-nowrap max-md:snap-x max-md:overflow-x-auto max-md:px-3 max-md:pb-1 max-md:pt-1.5">
              {items.map(renderCard)}
            </div>
          ) : (
            <>
              {imageItems.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-2">
                  {imageItems.map(renderRowsImage)}
                </div>
              ) : null}
              {fileItems.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {fileItems.map(renderRowsFile)}
                </div>
              ) : null}
            </>
          )}
          {visibleNotice ? (
            <p
              id={noticeId}
              role="status"
              className="mt-1 text-xs text-muted-foreground"
            >
              {visibleNotice.message}
            </p>
          ) : null}
          {inspectedFile?.inspect?.kind === "file" ? (
            <section
              aria-label={`Preview ${inspectedFile.name}`}
              className="mt-2 overflow-hidden rounded-lg border border-border"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs">
                <span className="truncate">{inspectedFile.name}</span>
                <button
                  type="button"
                  aria-label="Close file preview"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded hover:bg-state-hover"
                  onClick={() => {
                    const wrapper = Array.from(
                      trayRef.current?.querySelectorAll<HTMLElement>(
                        "[data-attachment-item]",
                      ) ?? [],
                    ).find(
                      (element) =>
                        element.dataset.attachmentItem === inspectedFile.key,
                    );
                    setInspectedFileKey(null);
                    wrapper
                      ?.querySelector<HTMLElement>("a[href], button")
                      ?.focus();
                  }}
                >
                  <Icon name="X" className="size-3" />
                </button>
              </div>
              <div className="h-56 overflow-auto">
                <Suspense
                  fallback={
                    <p role="status" className="p-3 text-xs">
                      Loading preview…
                    </p>
                  }
                >
                  <AttachmentFilePreview
                    key={`${attachmentProjectId}:${inspectedFile.key}`}
                    name={inspectedFile.name}
                    url={inspectedFile.inspect.href}
                  />
                </Suspense>
              </div>
            </section>
          ) : null}
          <span
            role="status"
            className={
              variant === "cards"
                ? "mt-1 block text-[11px] text-muted-foreground"
                : "sr-only"
            }
          >
            {pendingSummary}
          </span>
        </div>
      )}

      <ImageLightbox
        imageSrc={currentLightboxItem?.thumbnailSrc ?? null}
        imageAlt={currentLightboxItem?.name ?? "Attached image"}
        title="Attached image preview"
        hasMultipleImages={lightboxItems.length > 1}
        onPrevious={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || lightboxItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "previous",
                  itemCount: lightboxItems.length,
                }),
          );
        }}
        onNext={() => {
          onExpandedImageIndexChange(
            expandedImageIndex === null || lightboxItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "next",
                  itemCount: lightboxItems.length,
                }),
          );
        }}
        onClose={() => onExpandedImageIndexChange(null)}
      />
    </>
  );
}
