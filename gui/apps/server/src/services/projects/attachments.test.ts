import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyProjectAttachments,
  readAttachment,
  validatePromptAttachmentReferences,
  verifiedProjectUploadPath,
  withoutUnverifiedAttachments,
} from "./attachments.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-attachments-"));
  tempDirs.push(dir);
  return dir;
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

  it("copies project-scoped attachments without changing their draft paths", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "image-uploaded.png"), "image bytes");

    await copyProjectAttachments(dataDir, "proj_source", "proj_target", [
      "image-uploaded.png",
    ]);

    const copied = await readAttachment(
      dataDir,
      "proj_target",
      "image-uploaded.png",
    );
    expect(copied.content.toString("utf8")).toBe("image bytes");
  });

  it("copies image bytes exactly, again without error, and never overwrites a different target file", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    const targetDir = join(dataDir, "attachments", "proj_target");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(sourceDir, "shot.png"), png);
    await writeFile(join(sourceDir, "taken.png"), png);
    await writeFile(join(targetDir, "taken.png"), "other image");

    await copyProjectAttachments(dataDir, "proj_source", "proj_target", [
      "shot.png",
    ]);
    await copyProjectAttachments(dataDir, "proj_source", "proj_target", [
      "shot.png",
    ]);
    expect(
      (await readAttachment(dataDir, "proj_target", "shot.png")).content,
    ).toEqual(png);

    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_target", [
        "taken.png",
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(targetDir, "taken.png"), "utf8")).toBe(
      "other image",
    );
    expect(await readFile(join(sourceDir, "taken.png"))).toEqual(png);
    expect(await readFile(join(sourceDir, "shot.png"))).toEqual(png);
  });

  it("rejects copy paths that leave either project's attachment directory", async () => {
    const dataDir = await makeTempDir();
    await mkdir(join(dataDir, "attachments", "proj_other"), {
      recursive: true,
    });
    await writeFile(
      join(dataDir, "attachments", "proj_other", "secret.png"),
      "secret",
    );

    for (const path of ["../proj_other/secret.png", "/etc/passwd", "."]) {
      await expect(
        copyProjectAttachments(dataDir, "proj_source", "proj_target", [path]),
      ).rejects.toMatchObject({ status: 400 });
    }
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
    await expect(
      copyProjectAttachments(dataDir, "proj_test", "proj_other", ["escape.png"]),
    ).rejects.toMatchObject({ status: 404 });
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
    expect(
      await verifiedProjectUploadPath(dataDir, ["proj_b"], join(uploadsA, "a.png")),
    ).toBeNull();
    expect(
      await verifiedProjectUploadPath(dataDir, ["proj_b", "proj_a"], join(uploadsA, "a.png")),
    ).toBe(join(uploadsA, "a.png"));
    expect(
      await verifiedProjectUploadPath(dataDir, ["../attachments/proj_a"], join(uploadsA, "a.png")),
    ).toBeNull();
  });

  it("copies only to plain files inside the real target uploads folder", async () => {
    const dataDir = await realpath(await makeTempDir());
    const source = join(dataDir, "attachments", "proj_source");
    const outside = join(dataDir, "outside");
    await mkdir(join(source, "nested"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(source, "shot.png"), "shot");
    await writeFile(join(source, "nested", "new.png"), "nested");
    await mkdir(join(dataDir, "attachments", "proj_linkfile"), { recursive: true });
    await symlink(join(outside, "planted.png"), join(dataDir, "attachments", "proj_linkfile", "shot.png"));
    await symlink(outside, join(dataDir, "attachments", "proj_linkdir"));

    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_target", ["nested/new.png"]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_linkfile", ["shot.png"]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_linkdir", ["shot.png"]),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readdir(outside)).toEqual([]);
  });

  it("does not partially copy when one source attachment is missing", async () => {
    const dataDir = await makeTempDir();
    const sourceDir = join(dataDir, "attachments", "proj_source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "present.txt"), "present");

    await expect(
      copyProjectAttachments(dataDir, "proj_source", "proj_target", [
        "present.txt",
        "missing.txt",
      ]),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      readAttachment(dataDir, "proj_target", "present.txt"),
    ).rejects.toMatchObject({ status: 404 });
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
