import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import type { FilePreviewLineRange } from "@cloudroom/client-core";
import {
  buildAbsoluteFilePath,
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";
import { isRoutePath } from "./route-paths";

const THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION =
  "Thread file links are only available when the thread has an environment.";
const UNSAFE_PATH_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\\]/u;
const IMAGE_PREVIEW_NO_FOLDER_REASON =
  "The agent didn't report which folder this path is relative to.";
const IMAGE_PREVIEW_OUTSIDE_REASON =
  "Only images in this thread's workspace or storage can be previewed.";
const IMAGE_PREVIEW_OTHER_THREAD_REASON =
  "This image belongs to another thread's storage.";
const IMAGE_PREVIEW_OVERLAP_REASON =
  "This workspace contains Cloudroom's thread storage, so only this thread's storage can be previewed.";
const IMAGE_PREVIEW_UNKNOWN_ROOT_REASON =
  "This thread's files aren't available yet. Try again in a moment.";
const THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION =
  "Thread file links must use absolute file paths.";

interface ResolveThreadLocalFileLinkArgs {
  hostFileLinksAvailable: boolean;
  link: ThreadTimelineLocalFileLink;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

interface ResolveTimelineImagePreviewRootPathArgs {
  activeThreadId: string;
  cloudWorkspacePath: string | null;
  environment: { id: string; path: string | null } | undefined;
  thread:
    | { environmentId: string | null; executionTarget?: string; id: string }
    | undefined;
}

interface ResolveTimelineImagePreviewTargetArgs {
  cwd: string | null;
  isCloudThread: boolean;
  path: string;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

export type TimelineImagePreviewTarget =
  | { kind: "workspace"; path: string; relativePath: string }
  | { kind: "thread-storage"; path: string; relativePath: string }
  | { kind: "cloud-workspace"; path: string }
  | { kind: "rejected"; reason: string };

interface ThreadWorkspaceFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
  relativePath: string;
  workspaceRootPath: string;
}

interface ThreadHostFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
}

interface ThreadStorageFileLinkOpenRequest {
  lineRange: FilePreviewLineRange | null;
  path: string;
  relativePath: string;
  threadStorageRootPath: string;
}

interface ThreadLocalFileLinkAppRouteResolution {
  kind: "app-route";
}

interface ThreadLocalFileLinkErrorResolution {
  description: string;
  kind: "error";
}

interface ThreadWorkspaceFileLinkOpenResolution {
  kind: "open-workspace-path";
  request: ThreadWorkspaceFileLinkOpenRequest;
}

interface ThreadHostFileLinkOpenResolution {
  kind: "open-host-path";
  request: ThreadHostFileLinkOpenRequest;
}

interface ThreadStorageFileLinkOpenResolution {
  kind: "open-thread-storage-path";
  request: ThreadStorageFileLinkOpenRequest;
}

interface NormalizeLocalFilePathWithinRootArgs {
  linkPath: string;
  rootPath: string;
}

interface NormalizedLocalFilePathWithinRoot {
  path: string;
  relativePath: string;
  rootPath: string;
}

export type ThreadLocalFileLinkResolution =
  | ThreadLocalFileLinkAppRouteResolution
  | ThreadLocalFileLinkErrorResolution
  | ThreadWorkspaceFileLinkOpenResolution
  | ThreadHostFileLinkOpenResolution
  | ThreadStorageFileLinkOpenResolution;

function normalizeLocalFilePathWithinRoot(
  args: NormalizeLocalFilePathWithinRootArgs,
): NormalizedLocalFilePathWithinRoot | null {
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: args.rootPath });
  if (!normalizedRootPath) {
    return null;
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.linkPath });
  if (!normalizedPath) {
    return null;
  }

  if (
    !isAbsoluteFilePathWithinRoot({
      candidatePath: normalizedPath,
      rootPath: normalizedRootPath,
    }) ||
    normalizedPath === normalizedRootPath
  ) {
    return null;
  }

  const relativePath =
    normalizedRootPath === "/"
      ? normalizedPath.slice(1)
      : normalizedPath.slice(normalizedRootPath.length + 1);

  return {
    path: normalizedPath,
    relativePath,
    rootPath: normalizedRootPath,
  };
}

export function resolveThreadLocalFileLink(
  args: ResolveThreadLocalFileLinkArgs,
): ThreadLocalFileLinkResolution {
  if (isRoutePath({ path: args.link.path })) {
    return {
      kind: "app-route",
    };
  }

  const normalizedPath = normalizeAbsoluteFilePath({ path: args.link.path });
  if (!normalizedPath) {
    return {
      description: THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION,
      kind: "error",
    };
  }

  const openRequest =
    args.workspaceRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.workspaceRootPath,
        });

  if (openRequest) {
    return {
      kind: "open-workspace-path",
      request: {
        lineRange: args.link.lineRange,
        path: openRequest.path,
        relativePath: openRequest.relativePath,
        workspaceRootPath: openRequest.rootPath,
      },
    };
  }

  const storageOpenRequest =
    args.threadStorageRootPath === null
      ? null
      : normalizeLocalFilePathWithinRoot({
          linkPath: normalizedPath,
          rootPath: args.threadStorageRootPath,
        });

  if (storageOpenRequest) {
    return {
      kind: "open-thread-storage-path",
      request: {
        lineRange: args.link.lineRange,
        path: storageOpenRequest.path,
        relativePath: storageOpenRequest.relativePath,
        threadStorageRootPath: storageOpenRequest.rootPath,
      },
    };
  }

  if (!args.hostFileLinksAvailable) {
    return {
      description: THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION,
      kind: "error",
    };
  }

  return {
    kind: "open-host-path",
    request: {
      lineRange: args.link.lineRange,
      path: normalizedPath,
    },
  };
}

export function resolveTimelineImagePreviewRootPath({
  activeThreadId,
  cloudWorkspacePath,
  environment,
  thread,
}: ResolveTimelineImagePreviewRootPathArgs): string | null {
  if (thread?.id !== activeThreadId) {
    return null;
  }
  if (environment !== undefined && environment.id === thread.environmentId) {
    return environment.path;
  }
  return thread.executionTarget === "cloud" ? cloudWorkspacePath : null;
}

function rejectImagePreview(reason: string): TimelineImagePreviewTarget {
  return { kind: "rejected", reason };
}

export function resolveTimelineImagePreviewTarget({
  cwd,
  isCloudThread,
  path,
  threadStorageRootPath,
  workspaceRootPath,
}: ResolveTimelineImagePreviewTargetArgs): TimelineImagePreviewTarget | null {
  if (
    !/\.png$/iu.test(path) ||
    UNSAFE_PATH_CHARACTERS.test(path) ||
    (cwd !== null && UNSAFE_PATH_CHARACTERS.test(cwd)) ||
    /^(?:~|[a-z][a-z0-9+.-]*:)/iu.test(path)
  ) {
    return null;
  }
  const isAbsolute = path.startsWith("/");
  if (!isAbsolute && cwd === null) {
    return rejectImagePreview(IMAGE_PREVIEW_NO_FOLDER_REASON);
  }
  const absolutePath = normalizeAbsoluteFilePath({
    path:
      isAbsolute || cwd === null
        ? path
        : buildAbsoluteFilePath({ path, rootPath: cwd }),
  });
  if (absolutePath === null || isRoutePath({ path: absolutePath })) {
    return null;
  }

  if (isCloudThread) {
    if (workspaceRootPath === null) {
      return rejectImagePreview(IMAGE_PREVIEW_UNKNOWN_ROOT_REASON);
    }
    const checkoutPath = normalizeLocalFilePathWithinRoot({
      linkPath: absolutePath,
      rootPath: workspaceRootPath,
    });
    return checkoutPath === null
      ? rejectImagePreview(IMAGE_PREVIEW_OUTSIDE_REASON)
      : { kind: "cloud-workspace", path: checkoutPath.path };
  }

  if (threadStorageRootPath === null) {
    return rejectImagePreview(IMAGE_PREVIEW_UNKNOWN_ROOT_REASON);
  }
  const storagePath = normalizeLocalFilePathWithinRoot({
    linkPath: absolutePath,
    rootPath: threadStorageRootPath,
  });
  if (storagePath !== null) {
    return {
      kind: "thread-storage",
      path: storagePath.path,
      relativePath: storagePath.relativePath,
    };
  }
  const allThreadStoragePath = getAbsoluteDirname({
    path: threadStorageRootPath,
  });
  if (
    isAbsoluteFilePathWithinRoot({
      candidatePath: absolutePath,
      rootPath: allThreadStoragePath,
    })
  ) {
    return rejectImagePreview(IMAGE_PREVIEW_OTHER_THREAD_REASON);
  }
  if (workspaceRootPath === null) {
    return rejectImagePreview(IMAGE_PREVIEW_OUTSIDE_REASON);
  }
  if (
    isAbsoluteFilePathWithinRoot({
      candidatePath: allThreadStoragePath,
      rootPath: workspaceRootPath,
    })
  ) {
    return rejectImagePreview(IMAGE_PREVIEW_OVERLAP_REASON);
  }
  const workspacePath = normalizeLocalFilePathWithinRoot({
    linkPath: absolutePath,
    rootPath: workspaceRootPath,
  });
  return workspacePath === null
    ? rejectImagePreview(IMAGE_PREVIEW_OUTSIDE_REASON)
    : {
        kind: "workspace",
        path: workspacePath.path,
        relativePath: workspacePath.relativePath,
      };
}
