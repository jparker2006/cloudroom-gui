import { useEffect, useState } from "react";
import {
  assertNever,
  fileNameFromPath,
  type TimelineViewWorkRow,
} from "@cloudroom/thread-view";
import { EventCodeBlock } from "../../ui/event-code-block.js";
import { ImageLightbox } from "../../ui/image-lightbox.js";
import { EmptyStatePanel } from "@cloudroom/shared-ui/empty-state";
import {
  PreviewableOutputBody,
  type OutputViewerDirection,
} from "./OutputViewer.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";
import { LazyTimelineFileDiffBlock } from "./LazyTimelineFileDiffBlock.js";
import { QuestionWorkRowBody } from "./QuestionWorkRowBody.js";
import { WorkflowWorkRowBody } from "./WorkflowWorkRowBody.js";
import {
  PlanStepsWorkRowBody,
  PresentationDetail,
} from "./PresentationWorkRowBodies.js";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";
import type { ThreadTimelineImageViewSrcResolver } from "./types.js";

interface WorkRowBodyProps {
  outputViewerDirection?: OutputViewerDirection;
  resolveImageViewSrc?: ThreadTimelineImageViewSrcResolver;
  row: TimelineViewWorkRow;
  workspaceRootPath: string | undefined;
}

type ImageWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "image-view" | "image-generation" }
>;

interface ImageWorkRowBodyProps {
  resolveImageViewSrc?: ThreadTimelineImageViewSrcResolver;
  row: ImageWorkRow;
}

interface ResolveImageViewSourceArgs {
  resolveImageViewSrc: ThreadTimelineImageViewSrcResolver | undefined;
  row: ImageWorkRow;
}

function resolveImageViewSource({
  resolveImageViewSrc,
  row,
}: ResolveImageViewSourceArgs): string | null {
  if (!row.path || (row.workKind === "image-generation" && row.error)) {
    return null;
  }
  return resolveImageViewSrc
    ? resolveImageViewSrc({ path: row.path, threadId: row.threadId })
    : buildThreadHostFileContentUrl(row.threadId, row.path);
}

function ImageWorkRowBody({ resolveImageViewSrc, row }: ImageWorkRowBodyProps) {
  const [loadError, setLoadError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageSrc = resolveImageViewSource({ resolveImageViewSrc, row });
  const imageName = row.path ? fileNameFromPath(row.path) : "";
  const imageAlt = `${row.workKind === "image-generation" ? "Generated" : "Viewed"} image: ${imageName}`;

  useEffect(() => {
    setLoadError(false);
    setLightboxOpen(false);
  }, [imageSrc, row.completedAt, row.status]);

  if (loadError || !imageSrc) {
    return (
      <EmptyStatePanel className="rounded-lg">
        <div className="whitespace-pre-wrap break-words">
          {row.workKind === "image-generation" && row.error
            ? row.error
            : "Image preview unavailable."}
        </div>
        <div className="mt-1 break-all font-mono text-xs">{row.path}</div>
      </EmptyStatePanel>
    );
  }

  return (
    <>
      <button
        type="button"
        className="block w-full max-w-80 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-96"
        onClick={() => setLightboxOpen(true)}
        aria-label={`Open image preview: ${imageName}`}
      >
        <img
          src={imageSrc}
          alt=""
          className="block h-auto w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setLoadError(true)}
        />
      </button>
      <ImageLightbox
        imageAlt={imageAlt}
        imageSrc={lightboxOpen ? imageSrc : null}
        onClose={() => setLightboxOpen(false)}
        title={imageAlt}
      />
    </>
  );
}

export function WorkRowBody({
  outputViewerDirection = "reader",
  resolveImageViewSrc,
  row,
  workspaceRootPath,
}: WorkRowBodyProps) {
  switch (row.workKind) {
    case "command":
      return (
        <PreviewableOutputBody
          key={`${row.threadId}:${row.id}`}
          row={row}
          direction={outputViewerDirection}
        />
      );
    case "tool":
      return (
        <>
          <PresentationDetail presentation={row.presentation} />
          <PreviewableOutputBody
            key={`${row.threadId}:${row.id}`}
            row={row}
            direction={outputViewerDirection}
          />
        </>
      );
    case "file-change":
      return (
        <div className="space-y-2">
          <LazyTimelineFileDiffBlock
            change={row.change}
            workspaceRootPath={workspaceRootPath}
          />
          {row.stderr ? (
            <TimelineDetailScroll
              size="base"
              contentKey={row.stderr}
              className="rounded-md"
            >
              <EventCodeBlock
                tone="danger"
                className="rounded-none border-0 px-2 py-1.5"
              >
                {row.stderr}
              </EventCodeBlock>
            </TimelineDetailScroll>
          ) : null}
        </div>
      );
    case "delegation":
      return null;
    case "question":
      return <QuestionWorkRowBody row={row} />;
    case "workflow":
      return (
        <div className="space-y-2">
          <PresentationDetail presentation={row.presentation} />
          <WorkflowWorkRowBody row={row} />
        </div>
      );
    case "plan-steps":
      return <PlanStepsWorkRowBody row={row} />;
    case "extension":
      return <PresentationDetail presentation={row.presentation} />;
    case "image-generation":
    case "image-view":
      return (
        <ImageWorkRowBody row={row} resolveImageViewSrc={resolveImageViewSrc} />
      );
    case "approval":
    case "web-search":
    case "web-fetch":
    case "file-read":
    case "search":
      return null;
    default:
      return assertNever(row);
  }
}
