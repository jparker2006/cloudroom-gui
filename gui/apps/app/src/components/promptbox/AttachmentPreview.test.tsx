// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalAttachmentPreviews,
  registerLocalAttachmentPreview,
} from "@/lib/attachment-local-previews";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import { AttachmentPreview } from "./AttachmentPreview";
import type { PendingAttachment } from "./pending-attachments";

vi.mock("@/components/secondary-panel/FilePreview", () => ({
  FilePreview: ({
    state,
  }: {
    state: { kind: string; file?: { contents: string }; message?: string };
  }) => <pre>{state.file?.contents ?? state.message ?? state.kind}</pre>,
}));

const mixedAttachments: PromptDraftAttachment[] = [
  {
    type: "localImage",
    path: "shot-1-abc.png",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 2048,
  },
  {
    type: "localFile",
    path: "notes-2-def.md",
    name: "notes.md",
    mimeType: "text/markdown",
    sizeBytes: 0,
  },
  {
    type: "localFile",
    path: "bundle-3-ghi.zip",
    name: "bundle.zip",
    mimeType: "application/zip",
    sizeBytes: 3 * 1024 * 1024,
  },
  {
    type: "localFile",
    path: "/Users/me/outside.log",
    name: "outside.log",
    sizeBytes: 0,
  },
];

const pendingEntries: PendingAttachment[] = [
  {
    id: "p1",
    name: "queued-report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    status: "queued",
  },
  {
    id: "p2",
    name: "uploading.png",
    mimeType: "image/png",
    sizeBytes: 10,
    status: "uploading",
  },
  {
    id: "p3",
    name: "IMG_0001.heic",
    mimeType: "image/heic",
    sizeBytes: 10,
    status: "failed",
    error: "HEIC images are not supported.",
  },
];

describe("AttachmentPreview", () => {
  const revoked: string[] = [];
  let created = 0;

  beforeEach(() => {
    created = 0;
    revoked.length = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => `blob:local-${++created}`,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: (url: string) => {
        revoked.push(url);
      },
    });
  });

  afterEach(() => {
    cleanup();
    clearLocalAttachmentPreviews();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("uses the source project for image and file previews after a draft changes project", async () => {
    const fetchPreview = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        text: async () => "Source project notes",
      });
    vi.stubGlobal("fetch", fetchPreview);
    const attachments = mixedAttachments
      .slice(0, 2)
      .map((attachment) => ({ ...attachment, projectId: "source-project" }));
    const { getByRole, findByText } = render(
      <AttachmentPreview
        attachmentProjectId="destination-project"
        attachments={attachments}
        expandedImageIndex={null}
        onExpandedImageIndexChange={vi.fn()}
      />,
    );
    expect(getByRole("img", { name: "shot.png" }).getAttribute("src")).toBe(
      "/api/v1/projects/source-project/attachments/content?path=shot-1-abc.png",
    );
    fireEvent.click(getByRole("button", { name: /^Preview notes\.md/ }));
    expect(await findByText("Source project notes")).toBeTruthy();
    expect(fetchPreview).toHaveBeenCalledWith(
      "/api/v1/projects/source-project/attachments/content?path=notes-2-def.md",
      expect.anything(),
    );
  });

  it("inspects text through the project attachment contract and aborts on detach", async () => {
    const fetchPreview = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "# Attachment notes" });
    vi.stubGlobal("fetch", fetchPreview);
    const props = {
      attachmentProjectId: "proj_1",
      attachments: mixedAttachments.slice(1, 2),
      expandedImageIndex: null,
      onExpandedImageIndexChange: vi.fn(),
    };
    const { getByRole, findByText, rerender, queryByRole } = render(
      <AttachmentPreview {...props} />,
    );
    fireEvent.click(getByRole("button", { name: /^Preview notes\.md/ }));
    expect(await findByText("# Attachment notes")).toBeTruthy();
    expect(fetchPreview).toHaveBeenCalledWith(
      "/api/v1/projects/proj_1/attachments/content?path=notes-2-def.md",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const signal = fetchPreview.mock.calls[0]![1].signal as AbortSignal;
    rerender(<AttachmentPreview {...props} attachments={[]} />);
    expect(signal.aborted).toBe(true);
    expect(queryByRole("region", { name: "Preview notes.md" })).toBeNull();
  });

  it("explains a failed content preview without detaching the file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const onRemoveAttachment = vi.fn();
    const { getByRole, findByText } = render(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={mixedAttachments.slice(1, 2)}
        expandedImageIndex={null}
        onExpandedImageIndexChange={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );
    fireEvent.click(getByRole("button", { name: /^Preview notes\.md/ }));
    expect(
      await findByText(
        "Couldn't load this attachment preview. It is still attached.",
      ),
    ).toBeTruthy();
    expect(onRemoveAttachment).not.toHaveBeenCalled();
  });

  it("renders a just-picked image from its local object URL and revokes it on remove", () => {
    registerLocalAttachmentPreview(
      "photo-1-abc.png",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );
    registerLocalAttachmentPreview(
      "notes-1-abc.txt",
      new Blob(["hi"], { type: "text/plain" }),
    );
    const onRemoveAttachment = vi.fn();
    const { getAllByRole, getByLabelText } = render(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={[
          {
            type: "localImage",
            path: "photo-1-abc.png",
            name: "photo.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            type: "localImage",
            path: "restored-2-def.png",
            name: "restored.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ]}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );
    const images = getAllByRole("img");
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "blob:local-1",
      "/api/v1/projects/proj_1/attachments/content?path=restored-2-def.png",
    ]);
    expect(
      images.every((image) => image.getAttribute("decoding") === "async"),
    ).toBe(true);

    fireEvent.click(getByLabelText("Remove photo.png"));
    expect(onRemoveAttachment).toHaveBeenCalledWith("photo-1-abc.png");
    expect(revoked).toEqual(["blob:local-1"]);
  });

  it("separates compact touch targets from attachment remove visuals", () => {
    const { getByRole } = render(
      <AttachmentPreview
        attachments={[
          {
            type: "localImage",
            path: "screenshot.png",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            type: "localFile",
            path: "diff.patch",
            name: "diff.patch",
            mimeType: "text/plain",
            sizeBytes: 3,
          },
        ]}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={() => {}}
      />,
    );

    const imageRemoveButton = getByRole("button", {
      name: "Remove screenshot.png",
    });
    expect(
      imageRemoveButton.classList.contains("max-md:pointer-coarse:size-7"),
    ).toBe(true);
    expect(imageRemoveButton.classList.contains("bg-black/55")).toBe(false);
    expect(
      imageRemoveButton.firstElementChild?.classList.contains("size-4"),
    ).toBe(true);
    expect(
      imageRemoveButton.firstElementChild?.classList.contains("bg-black/55"),
    ).toBe(true);

    const fileRemoveButton = getByRole("button", {
      name: "Remove diff.patch",
    });
    expect(
      fileRemoveButton.classList.contains("max-md:pointer-coarse:size-7"),
    ).toBe(true);
    expect(fileRemoveButton.parentElement?.classList.contains("size-4")).toBe(
      true,
    );
    expect(
      fileRemoveButton.firstElementChild?.classList.contains("size-4"),
    ).toBe(true);
  });

  it.each(["rows", "cards"] as const)(
    "shows truthful states, metadata and inspect targets (%s)",
    (variant) => {
      const { container, getByRole, getByText, queryByText } = render(
        <AttachmentPreview
          variant={variant}
          attachmentProjectId="proj_1"
          attachments={mixedAttachments}
          pending={pendingEntries}
          expandedImageIndex={null}
          onExpandedImageIndexChange={() => {}}
          onRemoveAttachment={() => {}}
          onDismissPending={() => {}}
        />,
      );

      expect(container.textContent).not.toContain("0 B");
      expect(getByText("ZIP · 3.0 MB")).toBeTruthy();
      expect(getByRole("button", { name: /^Preview shot\.png/ })).toBeTruthy();
      expect(getByRole("button", { name: /^Preview notes\.md/ })).toBeTruthy();
      expect(
        getByRole("group", { name: /queued-report\.pdf, Queued/ }),
      ).toBeTruthy();
      expect(
        getByRole("group", { name: /uploading\.png, Uploading…/ }),
      ).toBeTruthy();
      expect(
        getByRole("group", {
          name: /IMG_0001\.heic, Failed, HEIC images are not supported\./,
        }),
      ).toBeTruthy();
      expect(getByRole("status").textContent).toBe(
        "1 uploading, 1 queued, 1 failed: IMG_0001.heic",
      );
      expect(
        getByRole("button", { name: "Dismiss failed upload IMG_0001.heic" }),
      ).toBeTruthy();

      fireEvent.click(getByRole("button", { name: /^bundle\.zip/ }));
      expect(
        getByText(
          "Preview not available for ZIP files. bundle.zip is still attached.",
        ),
      ).toBeTruthy();
      fireEvent.click(getByRole("button", { name: /^outside\.log/ }));
      expect(queryByText(/bundle\.zip is still attached/)).toBeNull();
      expect(
        getByText(
          "Preview not available for files outside this project's attachments. outside.log is still attached.",
        ),
      ).toBeTruthy();
    },
  );

  it("removes with the keyboard and moves focus to the next item, then the editor", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const onRestoreEditorFocus = vi.fn();
    const onRemoveAttachment = vi.fn();
    const { getByRole, rerender } = render(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={mixedAttachments.slice(1, 3)}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={onRemoveAttachment}
        onRestoreEditorFocus={onRestoreEditorFocus}
      />,
    );

    const notes = getByRole("button", { name: /^Preview notes\.md/ });
    notes.focus();
    fireEvent.keyDown(notes, { key: "Delete" });
    expect(onRemoveAttachment).toHaveBeenCalledWith("notes-2-def.md");
    rerender(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={mixedAttachments.slice(2, 3)}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={onRemoveAttachment}
        onRestoreEditorFocus={onRestoreEditorFocus}
      />,
    );
    act(() => frames.shift()?.(0));
    expect(document.activeElement).toBe(
      getByRole("button", { name: /^bundle\.zip/ }),
    );
    expect(onRestoreEditorFocus).not.toHaveBeenCalled();

    fireEvent.click(getByRole("button", { name: "Remove bundle.zip" }), {
      detail: 0,
    });
    expect(onRemoveAttachment).toHaveBeenLastCalledWith("bundle-3-ghi.zip");
    expect(onRestoreEditorFocus).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it.each(["explicit owner", "current project"] as const)(
    "tries the new resource after a same-filename project change (%s)",
    (ownership) => {
      const attachment = {
        ...mixedAttachments[0]!,
        path: "shared-shot.png",
        name: "shared-shot.png",
      };
      const propsFor = (projectId: string) => ({
        attachments: [
          ownership === "explicit owner"
            ? { ...attachment, projectId }
            : { ...attachment },
        ],
        attachmentProjectId:
          ownership === "explicit owner" ? "composer-project" : projectId,
        expandedImageIndex: null,
        onExpandedImageIndexChange: vi.fn(),
      });
      const { getByRole, queryByRole, rerender } = render(
        <AttachmentPreview {...propsFor("project-a")} />,
      );
      const firstImage = getByRole("img", { name: "shared-shot.png" });
      expect(firstImage.getAttribute("src")).toBe(
        "/api/v1/projects/project-a/attachments/content?path=shared-shot.png",
      );
      fireEvent.error(firstImage);
      expect(queryByRole("img", { name: "shared-shot.png" })).toBeNull();

      rerender(<AttachmentPreview {...propsFor("project-a")} />);
      expect(queryByRole("img", { name: "shared-shot.png" })).toBeNull();

      rerender(<AttachmentPreview {...propsFor("project-b")} />);
      expect(
        queryByRole("img", { name: "shared-shot.png" })?.getAttribute("src"),
      ).toBe(
        "/api/v1/projects/project-b/attachments/content?path=shared-shot.png",
      );

      fireEvent.error(getByRole("img", { name: "shared-shot.png" }));
      rerender(<AttachmentPreview {...propsFor("project-b")} />);
      expect(queryByRole("img", { name: "shared-shot.png" })).toBeNull();
      expect(
        within(getByRole("button", { name: /^shared-shot\.png,/ })).getByText(
          "No preview",
        ),
      ).toBeTruthy();
    },
  );

  it("retains the honest fallback when the failed resource has not changed", () => {
    const attachment = { ...mixedAttachments[0]!, projectId: "source-project" };
    const onExpandedImageIndexChange = vi.fn();
    const props = {
      attachments: [attachment],
      attachmentProjectId: "composer-project-a",
      expandedImageIndex: null,
      onExpandedImageIndexChange,
    };
    const { getByRole, queryByRole, getByText, rerender } = render(
      <AttachmentPreview {...props} />,
    );
    fireEvent.error(getByRole("img", { name: "shot.png" }));
    for (let sizeBytes = 1; sizeBytes <= 3; sizeBytes += 1) {
      rerender(
        <AttachmentPreview
          {...props}
          attachmentProjectId="composer-project-b"
          attachments={[{ ...attachment, sizeBytes }]}
        />,
      );
      expect(queryByRole("img", { name: "shot.png" })).toBeNull();
      expect(getByText("No preview")).toBeTruthy();
    }
    fireEvent.click(getByRole("button", { name: /^shot\.png,/ }));
    expect(
      getByText("Couldn't load a preview of shot.png. It is still attached."),
    ).toBeTruthy();
    expect(onExpandedImageIndexChange).not.toHaveBeenCalled();
  });

  it.each(["explicit owner", "current project"] as const)(
    "hides the previous resource's failure notice after a project change (%s)",
    (ownership) => {
      const attachment = {
        ...mixedAttachments[0]!,
        path: "shared-shot.png",
        name: "shared-shot.png",
      };
      const propsFor = (projectId: string) => ({
        attachments: [
          ownership === "explicit owner"
            ? { ...attachment, projectId }
            : { ...attachment },
        ],
        attachmentProjectId:
          ownership === "explicit owner" ? "composer-project" : projectId,
        expandedImageIndex: null,
        onExpandedImageIndexChange: vi.fn(),
      });
      const { getByRole, getByText, queryByText, rerender } = render(
        <AttachmentPreview {...propsFor("project-a")} />,
      );
      const message =
        "Couldn't load a preview of shared-shot.png. It is still attached.";
      fireEvent.error(getByRole("img", { name: "shared-shot.png" }));
      fireEvent.click(getByRole("button", { name: /^shared-shot\.png,/ }));
      expect(getByText(message).getAttribute("role")).toBe("status");

      rerender(<AttachmentPreview {...propsFor("project-b")} />);
      const nextImage = getByRole("img", { name: "shared-shot.png" });
      expect(nextImage.getAttribute("src")).toBe(
        "/api/v1/projects/project-b/attachments/content?path=shared-shot.png",
      );
      expect(queryByText(message)).toBeNull();

      fireEvent.error(nextImage);
      expect(queryByText(message)).toBeNull();
      fireEvent.click(getByRole("button", { name: /^shared-shot\.png,/ }));
      expect(getByText(message).getAttribute("role")).toBe("status");
    },
  );

  it("retains the failure notice for the unchanged failed resource without retrying", () => {
    const attachment = { ...mixedAttachments[0]!, projectId: "source-project" };
    const onExpandedImageIndexChange = vi.fn();
    const props = {
      attachments: [attachment],
      attachmentProjectId: "composer-project-a",
      expandedImageIndex: null,
      onExpandedImageIndexChange,
    };
    const { getByRole, getByText, queryByRole, rerender } = render(
      <AttachmentPreview {...props} />,
    );
    const message = "Couldn't load a preview of shot.png. It is still attached.";
    fireEvent.error(getByRole("img", { name: "shot.png" }));
    fireEvent.click(getByRole("button", { name: /^shot\.png,/ }));
    expect(getByText(message).getAttribute("role")).toBe("status");
    for (let sizeBytes = 1; sizeBytes <= 3; sizeBytes += 1) {
      rerender(
        <AttachmentPreview
          {...props}
          attachmentProjectId="composer-project-b"
          attachments={[{ ...attachment, sizeBytes }]}
        />,
      );
      expect(queryByRole("img", { name: "shot.png" })).toBeNull();
      expect(getByText("No preview")).toBeTruthy();
      expect(getByText(message).getAttribute("role")).toBe("status");
    }
    expect(onExpandedImageIndexChange).not.toHaveBeenCalled();
  });

  it("falls back cleanly when a thumbnail cannot load", () => {
    const onExpandedImageIndexChange = vi.fn();
    const { getByRole, getAllByRole, getByText } = render(
      <AttachmentPreview
        attachmentProjectId="proj_1"
        attachments={[
          mixedAttachments[0]!,
          {
            type: "localImage",
            path: "second-4-jkl.png",
            name: "second.png",
            sizeBytes: 0,
          },
        ]}
        expandedImageIndex={null}
        onExpandedImageIndexChange={onExpandedImageIndexChange}
        onRemoveAttachment={() => {}}
      />,
    );

    fireEvent.error(getAllByRole("img", { name: "shot.png" })[0]!);
    const broken = getByRole("button", { name: /^shot\.png, PNG · 2 KB$/ });
    expect(within(broken).getByText("No preview")).toBeTruthy();
    fireEvent.click(broken);
    expect(onExpandedImageIndexChange).not.toHaveBeenCalled();
    expect(
      getByText("Couldn't load a preview of shot.png. It is still attached."),
    ).toBeTruthy();

    fireEvent.click(getByRole("button", { name: /^Preview second\.png/ }));
    expect(onExpandedImageIndexChange).toHaveBeenCalledWith(0);
  });

  it("dismisses pending entries without touching draft attachments", () => {
    const onDismissPending = vi.fn();
    const onRemoveAttachment = vi.fn();
    const { getByRole } = render(
      <AttachmentPreview
        attachments={[]}
        pending={pendingEntries}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={onRemoveAttachment}
        onDismissPending={onDismissPending}
      />,
    );
    fireEvent.click(getByRole("button", { name: "Remove uploading.png" }));
    fireEvent.click(
      getByRole("button", { name: "Dismiss failed upload IMG_0001.heic" }),
    );
    expect(onDismissPending.mock.calls).toEqual([["p2"], ["p3"]]);
    expect(onRemoveAttachment).not.toHaveBeenCalled();
  });

  it("summarizes pending work in compact mode without controls", () => {
    const { container } = render(
      <AttachmentPreview
        compact
        attachments={mixedAttachments.slice(0, 1)}
        pending={pendingEntries}
        expandedImageIndex={null}
        onExpandedImageIndexChange={() => {}}
        onRemoveAttachment={() => {}}
      />,
    );
    const chip = container.querySelector("[data-promptbox-attachments]");
    expect(chip?.getAttribute("aria-label")).toBe(
      "4 attachments, 1 uploading, 1 queued, 1 failed: IMG_0001.heic",
    );
    expect(chip?.querySelectorAll("button")).toHaveLength(0);
  });
});
