import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../errors.js";
import {
  copyAttachmentsWithTokens,
  readAttachment,
  resolveProjectAttachmentFile,
  storeAttachment,
  validatePromptAttachmentReferences,
  withoutUnverifiedAttachments,
} from "./attachments.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
}

const allowAll = (): void => {};

async function upload(
  dataDir: string,
  projectId: string,
  name: string,
  bytes: string | Buffer<ArrayBuffer>,
) {
  const type = name.endsWith(".png") ? "image/png" : "text/plain";
  const uploaded = await storeAttachment(
    dataDir,
    projectId,
    new File([bytes], name, { type }),
  );
  return {
    ...uploaded,
    file: join(dataDir, "attachments", projectId, uploaded.path),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("project attachments", () => {
  it("reads attachments from inside the project attachment directory", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");
    const attachmentPath = join(attachmentDir, "notes.txt");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "hello", "utf8");

    const result = await readAttachment(dataDir, "proj_test", "notes.txt");

    expect(result.content.toString("utf8")).toBe("hello");
    expect(result.mimeType).toBe("text/plain");
  });

  it("issues a copy token per upload and copies exactly those bytes, again without error", async () => {
    const dataDir = await makeTempDir();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);
    const shot = await upload(dataDir, "proj_source", "shot.png", png);
    expect(shot.copyToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    await copyAttachmentsWithTokens(dataDir, "proj_target", [shot.copyToken], allowAll);
    await copyAttachmentsWithTokens(dataDir, "proj_target", [shot.copyToken], allowAll);

    expect(
      (await readAttachment(dataDir, "proj_target", shot.path)).content,
    ).toEqual(png);
    expect(await readFile(shot.file)).toEqual(png);
  });

  it("never overwrites a different file already in the target project", async () => {
    const dataDir = await makeTempDir();
    const shot = await upload(dataDir, "proj_source", "shot.png", "shot");
    const targetDir = join(dataDir, "attachments", "proj_target");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, shot.path), "other image");

    await expect(
      copyAttachmentsWithTokens(dataDir, "proj_target", [shot.copyToken], allowAll),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(targetDir, shot.path), "utf8")).toBe("other image");
    expect(await readFile(shot.file, "utf8")).toBe("shot");
  });

  it("copies only server-issued tokens, never arbitrary paths", async () => {
    const dataDir = await makeTempDir();
    const shot = await upload(dataDir, "proj_source", "shot.png", "shot");
    await mkdir(join(dataDir, "attachments", "proj_other"), { recursive: true });
    await writeFile(join(dataDir, "attachments", "proj_other", "secret.png"), "secret");

    for (const token of [
      shot.path,
      "../proj_other/secret.png",
      "/etc/passwd",
      "",
      "A".repeat(43),
    ]) {
      await expect(
        copyAttachmentsWithTokens(dataDir, "proj_target", [token], allowAll),
      ).rejects.toMatchObject({ status: 403 });
    }
    const corrupt = "B".repeat(43);
    await writeFile(
      join(
        dataDir,
        "attachment-copy-tokens",
        `${createHash("sha256").update(corrupt).digest("hex")}.json`,
      ),
      "{}",
    );
    await expect(
      copyAttachmentsWithTokens(dataDir, "proj_target", [corrupt], allowAll),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readdir(join(dataDir, "attachments", "proj_target")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("authorizes the token's source project before reading it", async () => {
    const dataDir = await makeTempDir();
    const shot = await upload(dataDir, "proj_source", "shot.png", "shot");
    const checked: string[] = [];

    await expect(
      copyAttachmentsWithTokens(dataDir, "proj_target", [shot.copyToken], (projectId) => {
        checked.push(projectId);
        throw new ApiError(404, "invalid_request", "Project not found");
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(checked).toEqual(["proj_source"]);
    await expect(
      readAttachment(dataDir, "proj_target", shot.path),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a token whose upload was replaced, swapped for a symlink or removed, copying nothing", async () => {
    const dataDir = await makeTempDir();
    await writeFile(join(dataDir, "outside.png"), "secret");
    const kept = await upload(dataDir, "proj_source", "kept.png", "kept");
    const replaced = await upload(dataDir, "proj_source", "replaced.png", "original");
    const linked = await upload(dataDir, "proj_source", "linked.png", "linked");
    const removed = await upload(dataDir, "proj_source", "removed.png", "removed");
    await writeFile(replaced.file, "swapped");
    await rm(linked.file);
    await symlink(join(dataDir, "outside.png"), linked.file);
    await rm(removed.file);

    await expect(
      copyAttachmentsWithTokens(dataDir, "proj_target", [kept.copyToken, replaced.copyToken], allowAll),
    ).rejects.toMatchObject({ status: 409 });
    for (const token of [linked.copyToken, removed.copyToken]) {
      await expect(
        copyAttachmentsWithTokens(dataDir, "proj_target", [kept.copyToken, token], allowAll),
      ).rejects.toMatchObject({ status: 404 });
    }
    await expect(
      readAttachment(dataDir, "proj_target", kept.path),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("copies only to plain files inside the real target uploads folder", async () => {
    const dataDir = await realpath(await makeTempDir());
    const outside = join(dataDir, "outside");
    await mkdir(outside, { recursive: true });
    const shot = await upload(dataDir, "proj_source", "shot.png", "shot");
    await mkdir(join(dataDir, "attachments", "proj_linkfile"), { recursive: true });
    await symlink(join(outside, "planted.png"), join(dataDir, "attachments", "proj_linkfile", shot.path));
    await symlink(outside, join(dataDir, "attachments", "proj_linkdir"));

    for (const target of ["proj_linkfile", "proj_linkdir"]) {
      await expect(
        copyAttachmentsWithTokens(dataDir, target, [shot.copyToken], allowAll),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect(await readdir(outside)).toEqual([]);
  });

  it("follows symlinks only when they stay inside the project's uploads", async () => {
    const dataDir = await makeTempDir();
    const dir = join(dataDir, "attachments", "proj_test");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dataDir, "outside.png"), "secret");
    await writeFile(join(dir, "real.png"), "real");
    await symlink(join(dataDir, "outside.png"), join(dir, "escape.png"));
    await symlink(join(dir, "real.png"), join(dir, "alias.png"));

    expect(
      (await readAttachment(dataDir, "proj_test", "alias.png")).content.toString(),
    ).toBe("real");
    await expect(
      readAttachment(dataDir, "proj_test", "escape.png"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localImage", path: "escape.png" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps only verified uploads when Cloud queued messages become Local", async () => {
    const dataDir = await makeTempDir();
    await mkdir(join(dataDir, "attachments", "proj_b"), { recursive: true });
    await mkdir(join(dataDir, "attachments", "proj_a"), { recursive: true });
    await writeFile(join(dataDir, "attachments", "proj_b", "b.png"), "b");
    await writeFile(join(dataDir, "attachments", "proj_a", "a.png"), "a");
    const text = { type: "text" as const, text: "look", mentions: [] };
    const valid = [text, { type: "localImage" as const, path: "b.png" }];

    expect(
      await withoutUnverifiedAttachments(dataDir, "proj_b", valid),
    ).toBe(valid);
    expect(
      await withoutUnverifiedAttachments(dataDir, "proj_b", [
        text,
        { type: "localImage", path: "b.png" },
        { type: "localImage", path: "a.png" },
        { type: "localImage", path: "../proj_a/a.png" },
        { type: "localFile", path: "/etc/hosts", name: "hosts" },
      ]),
    ).toEqual([
      text,
      { type: "localImage", path: "b.png" },
      {
        type: "text",
        text: "[Attachments not delivered (missing, or not an upload of this project; you have not seen them, so ask the user to attach them again if the task depends on them): a.png, hosts.]",
        mentions: [],
      },
    ]);
  });

  it("never trusts a project uploads folder that is a symlink to another project", async () => {
    const dataDir = await realpath(await makeTempDir());
    const uploadsA = join(dataDir, "attachments", "proj_a");
    await mkdir(uploadsA, { recursive: true });
    await writeFile(join(uploadsA, "a.png"), "a");
    await symlink(uploadsA, join(dataDir, "attachments", "proj_b"));

    await expect(
      readAttachment(dataDir, "proj_b", "a.png"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_b",
        input: [{ type: "localImage", path: "a.png" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await resolveProjectAttachmentFile(dataDir, "proj_b", "a.png"),
    ).toBeNull();
    expect(
      await resolveProjectAttachmentFile(dataDir, "proj_a", "a.png"),
    ).toBe(join(uploadsA, "a.png"));
  });

  it("accepts prompt attachment references to uploaded project files", async () => {
    const dataDir = await makeTempDir();
    const attachmentDir = join(dataDir, "attachments", "proj_test");

    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "notes-uploaded.txt"), "hello", "utf8");

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "notes-uploaded.txt" }],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects relative prompt attachment paths that were not uploaded", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [{ type: "localFile", path: "alpha.txt" }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: expect.stringContaining(
          "relative workspace file paths are not valid attachment references",
        ),
      }),
    });
  });

  it("allows runtime-readable prompt attachment paths without upload validation", async () => {
    const dataDir = await makeTempDir();

    await expect(
      validatePromptAttachmentReferences({
        dataDir,
        projectId: "proj_test",
        input: [
          { type: "localFile", path: "/tmp/workspace/alpha.txt" },
          { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
          { type: "localFile", path: "https://example.test/notes.txt" },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects POSIX traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "../secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects Windows-style traversal outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "..\\secret.txt"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects absolute paths outside the project attachment directory", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "/etc/passwd"),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment path escapes project directory",
      }),
    });
  });

  it("rejects attachment paths that resolve to the attachment directory itself", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "."),
    ).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({
        code: "invalid_request",
        message:
          "Attachment path must refer to a file inside the project directory",
      }),
    });
  });

  it("treats percent-encoded traversal markers as literal file names", async () => {
    const dataDir = await makeTempDir();

    await expect(
      readAttachment(dataDir, "proj_test", "%2e%2e%2fsecret.txt"),
    ).rejects.toMatchObject({
      status: 404,
      body: expect.objectContaining({
        code: "invalid_request",
        message: "Attachment not found",
      }),
    });
  });
});
