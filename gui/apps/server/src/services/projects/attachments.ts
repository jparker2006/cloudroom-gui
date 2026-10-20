// oxlint-disable-next-line no-restricted-imports
import type { Stats } from "node:fs";
// oxlint-disable-next-line no-restricted-imports
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  win32,
} from "node:path";
import { resolveContainedPath } from "@cloudroom/process-utils";
import type { PromptInput } from "@cloudroom/domain";
import type { UploadedPromptAttachment } from "@cloudroom/server-contract";
import mimeTypes from "mime-types";
import { ApiError } from "../../errors.js";

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_LIMIT_BYTES = 25 * 1024 * 1024;

const HEIF_IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

type PromptAttachmentInput = Extract<
  PromptInput,
  { type: "localFile" | "localImage" }
>;

interface ValidatePromptAttachmentReferencesArgs {
  dataDir: string;
  input: PromptInput[];
  projectId: string;
}

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return base.length > 0 ? base : "attachment";
}

function buildStoredFilename(originalName: string): string {
  const sanitized = sanitizeFilename(originalName);
  const extension = extname(sanitized);
  const stem =
    extension.length > 0 ? sanitized.slice(0, -extension.length) : sanitized;
  return `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
}

function projectAttachmentDir(dataDir: string, projectId: string): string {
  return join(dataDir, "attachments", projectId);
}

function resolveAttachmentPath(
  attachmentDir: string,
  relativePath: string,
): string {
  const normalizedRelativePath = normalize(relativePath.replaceAll("\\", "/"));
  const resolvedAttachmentDir = resolve(attachmentDir);
  const resolvedCandidatePath = resolve(
    resolvedAttachmentDir,
    normalizedRelativePath,
  );

  if (resolvedCandidatePath === resolvedAttachmentDir) {
    throw new ApiError(
      400,
      "invalid_request",
      "Attachment path must refer to a file inside the project directory",
    );
  }

  const resolvedPath = resolveContainedPath({
    rootPath: resolvedAttachmentDir,
    candidatePath: resolvedCandidatePath,
  });

  if (resolvedPath) {
    return resolvedPath;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Attachment path escapes project directory",
  );
}

function pathLooksRuntimeReadable(rawPath: string): boolean {
  return (
    isAbsolute(rawPath) ||
    win32.isAbsolute(rawPath) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath)
  );
}

function shouldValidateProjectAttachmentReference(
  input: PromptInput,
): input is PromptAttachmentInput {
  if (input.type !== "localFile" && input.type !== "localImage") {
    return false;
  }
  return !pathLooksRuntimeReadable(input.path);
}

function missingAttachmentReferenceError(attachmentPath: string): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    `Attachment ${attachmentPath} was not uploaded for this project. Upload files with POST /api/v1/projects/:id/attachments and use the returned path in localFile/localImage prompt input; relative workspace file paths are not valid attachment references.`,
  );
}

async function ensureAttachmentReferenceExists(
  dataDir: string,
  projectId: string,
  attachmentPath: string,
): Promise<void> {
  if (!(await resolveStoredAttachment(dataDir, projectId, attachmentPath))) {
    throw missingAttachmentReferenceError(attachmentPath);
  }
}

export async function resolveProjectAttachmentFile(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<string | null> {
  if (pathLooksRuntimeReadable(relativePath)) return null;
  const stored = await resolveStoredAttachment(
    dataDir,
    projectId,
    relativePath,
  ).catch(() => null);
  return stored?.resolved ?? null;
}

export async function withoutUnverifiedAttachments(
  dataDir: string,
  projectId: string,
  input: PromptInput[],
): Promise<PromptInput[]> {
  const kept: PromptInput[] = [];
  const dropped: string[] = [];
  for (const part of input) {
    if (
      (part.type === "localImage" || part.type === "localFile") &&
      !(await resolveProjectAttachmentFile(dataDir, projectId, part.path))
    ) {
      dropped.push(basename(part.path.replaceAll("\\", "/")));
      continue;
    }
    kept.push(part);
  }
  if (dropped.length === 0) return input;
  return [
    ...kept,
    {
      type: "text",
      text: `[Attachments not delivered (missing, or not an upload of this project; you have not seen them, so ask the user to attach them again if the task depends on them): ${[...new Set(dropped)].join(", ")}.]`,
      mentions: [],
    },
  ];
}

async function resolveStoredAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<{ fileStat: Stats; resolved: string } | null> {
  const dir = projectAttachmentDir(dataDir, projectId);
  const [realDir, realFile] = await Promise.all([
    realpath(dir).catch(() => null),
    realpath(resolveAttachmentPath(dir, relativePath)).catch(() => null),
  ]);
  const resolved =
    realDir && realFile
      ? resolveContainedPath({ rootPath: realDir, candidatePath: realFile })
      : null;
  const fileStat = resolved ? await stat(resolved).catch(() => null) : null;
  return resolved && fileStat?.isFile() ? { fileStat, resolved } : null;
}

export async function validatePromptAttachmentReferences(
  args: ValidatePromptAttachmentReferencesArgs,
): Promise<void> {
  for (const input of args.input) {
    if (!shouldValidateProjectAttachmentReference(input)) {
      continue;
    }
    await ensureAttachmentReferenceExists(
      args.dataDir,
      args.projectId,
      input.path,
    );
  }
}

function isHeifImageUpload(file: File): boolean {
  const mimeType = (file.type.split(";")[0] ?? "").trim().toLowerCase();
  return HEIF_IMAGE_MIME_TYPES.has(mimeType);
}

export async function storeAttachment(
  dataDir: string,
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  if (isHeifImageUpload(file)) {
    throw new ApiError(
      400,
      "invalid_request",
      "HEIC images are not supported. Convert the image to JPEG or PNG before attaching it.",
    );
  }
  const isImage = (file.type || "").startsWith("image/");
  const sizeLimit = isImage ? IMAGE_LIMIT_BYTES : FILE_LIMIT_BYTES;
  if (file.size > sizeLimit) {
    throw new ApiError(
      400,
      "invalid_request",
      `Attachment exceeds ${Math.floor(sizeLimit / (1024 * 1024))}MB limit`,
    );
  }

  const dir = projectAttachmentDir(dataDir, projectId);
  await mkdir(dir, { recursive: true });

  const storedName = buildStoredFilename(file.name);
  const outputPath = join(dir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, bytes);

  return {
    type: isImage ? "localImage" : "localFile",
    path: storedName,
    name: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}

interface StoredAttachmentContent {
  content: Buffer<ArrayBuffer>;
  etag: string;
  mimeType?: string;
}

export async function readAttachment(
  dataDir: string,
  projectId: string,
  relativePath: string,
): Promise<StoredAttachmentContent> {
  const stored = await resolveStoredAttachment(dataDir, projectId, relativePath);
  if (!stored) {
    throw new ApiError(404, "invalid_request", "Attachment not found");
  }
  const { fileStat, resolved } = stored;

  return {
    content: await readFile(resolved),
    etag: `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`,
    mimeType: mimeTypes.lookup(resolved) || undefined,
  };
}

function attachmentCopyConflict(attachmentPath: string): ApiError {
  return new ApiError(
    409,
    "invalid_request",
    `Attachment ${attachmentPath} already exists in the target project with different content`,
  );
}

export async function copyProjectAttachments(
  dataDir: string,
  sourceProjectId: string,
  targetProjectId: string,
  attachmentPaths: readonly string[],
): Promise<void> {
  if (sourceProjectId === targetProjectId || attachmentPaths.length === 0) {
    return;
  }

  const uniquePaths = [...new Set(attachmentPaths)];
  const targetDir = projectAttachmentDir(dataDir, targetProjectId);
  const attachments = await Promise.all(
    uniquePaths.map(async (attachmentPath) => {
      const content = (
        await readAttachment(dataDir, sourceProjectId, attachmentPath)
      ).content;
      const targetPath = resolveAttachmentPath(targetDir, attachmentPath);
      const existing = await readFile(targetPath).catch(() => null);
      if (existing && !existing.equals(content)) {
        throw attachmentCopyConflict(attachmentPath);
      }
      return { attachmentPath, content, exists: existing !== null, targetPath };
    }),
  );

  await Promise.all(
    attachments.map(async ({ attachmentPath, content, exists, targetPath }) => {
      if (exists) return;
      await mkdir(dirname(targetPath), { recursive: true });
      try {
        await writeFile(targetPath, content, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(targetPath).catch(() => null);
        if (!existing?.equals(content)) {
          throw attachmentCopyConflict(attachmentPath);
        }
      }
    }),
  );
}

export async function deleteProjectAttachments(
  dataDir: string,
  projectId: string,
): Promise<void> {
  await rm(projectAttachmentDir(dataDir, projectId), {
    force: true,
    recursive: true,
  });
}
