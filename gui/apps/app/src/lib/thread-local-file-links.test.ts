import { describe, expect, it } from "vitest";
import {
  resolveOpenableTimelineImagePreviewLink,
  resolveThreadLocalFileLink,
  resolveTimelineImagePreviewLink,
  resolveTimelineImagePreviewRootPath,
} from "./thread-local-file-links";

describe("resolveThreadLocalFileLink", () => {
  it("leaves app routes as normal navigation", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/projects/proj_gyz9przugq/threads/thr_rq7r4uv8zg",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "app-route",
    });
  });

  it("opens host file links when there is no ready local workspace", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/Users/me/project/src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: null,
      }),
    ).toEqual({
      kind: "open-host-path",
      request: {
        lineRange: null,
        path: "/Users/me/project/src/file.ts",
      },
    });
  });

  it("rejects file links when host-file context is unavailable", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: false,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/.ssh/id_rsa",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      description:
        "Thread file links are only available when the thread has an environment.",
      kind: "error",
    });
  });

  it("opens paths outside the workspace root as host files", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/.ssh/id_rsa",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "open-host-path",
      request: {
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
        path: "/Users/me/.ssh/id_rsa",
      },
    });
  });

  it("normalizes paths before checking workspace containment", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/project/src/../src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project/",
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
        path: "/Users/me/project/src/file.ts",
        relativePath: "src/file.ts",
        workspaceRootPath: "/Users/me/project",
      },
    });
  });

  it("rejects relative file links", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 7, endLineNumber: 7 },
          path: "apps/app/src/main.tsx",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      description: "Thread file links must use absolute file paths.",
      kind: "error",
    });
  });

  it("does not mistake deeper filesystem paths for project routes", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/projects/my-repo/src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/projects/my-repo",
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: null,
        path: "/projects/my-repo/src/file.ts",
        relativePath: "src/file.ts",
        workspaceRootPath: "/projects/my-repo",
      },
    });
  });

  it("opens paths inside the known thread storage root as storage files", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 4, endLineNumber: 6 },
          path: "/Users/me/.bb/thread-storage/thr_one/reports/preview.html",
        },
        threadStorageRootPath: "/Users/me/.bb/thread-storage/thr_one",
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "open-thread-storage-path",
      request: {
        lineRange: { startLineNumber: 4, endLineNumber: 6 },
        path: "/Users/me/.bb/thread-storage/thr_one/reports/preview.html",
        relativePath: "reports/preview.html",
        threadStorageRootPath: "/Users/me/.bb/thread-storage/thr_one",
      },
    });
  });
});

describe("resolveTimelineImagePreviewLink", () => {
  const workspaceRootPath = "/home/me/project";

  function routeImage(args: {
    hostFileLinksAvailable: boolean;
    path: string;
    relativeRootPath?: string | null;
    threadStorageRootPath: string | null;
    workspaceRootPath: string | null;
  }) {
    const link = resolveTimelineImagePreviewLink({
      path: args.path,
      workspaceRootPath: args.relativeRootPath ?? args.workspaceRootPath,
    });
    return link === null
      ? null
      : resolveThreadLocalFileLink({
          hostFileLinksAvailable: args.hostFileLinksAvailable,
          link,
          threadStorageRootPath: args.threadStorageRootPath,
          workspaceRootPath: args.workspaceRootPath,
        });
  }

  it("resolves relative PNG paths against the thread workspace", () => {
    expect(
      resolveTimelineImagePreviewLink({
        path: "./assets/../assets/chart.PNG",
        workspaceRootPath,
      }),
    ).toEqual({ lineRange: null, path: "/home/me/project/assets/chart.PNG" });
  });

  it("keeps absolute PNG paths exact", () => {
    expect(
      resolveTimelineImagePreviewLink({
        path: "/tmp/screens/#1 shot.png",
        workspaceRootPath,
      }),
    ).toEqual({ lineRange: null, path: "/tmp/screens/#1 shot.png" });
  });

  it.each([
    ["relative traversal out of the workspace", "../other/secret.png"],
    ["deep relative traversal", "assets/../../../etc/passwd.png"],
    ["home-relative paths", "~/Desktop/shot.png"],
    ["file URLs", "file:///tmp/shot.png"],
    ["remote URLs", "https://example.com/shot.png"],
    ["Windows paths", "C:\\Users\\me\\shot.png"],
    ["backslash separators", "assets\\..\\..\\shot.png"],
    ["control characters", "assets/shot\u0000.png"],
    ["newlines", "assets/shot\n.png"],
    ["bidi overrides", "assets/a\u202Egnp.png"],
    ["bidi isolates", "assets/\u2066shot\u2069.png"],
    ["non-PNG files", "assets/notes.txt"],
    ["PNG-looking directories", "assets/png/"],
    ["app routes", "/settings/general.png"],
  ])("rejects %s", (_label, path) => {
    expect(
      resolveTimelineImagePreviewLink({ path, workspaceRootPath }),
    ).toBeNull();
  });

  it("rejects relative paths when the thread has no workspace", () => {
    expect(
      resolveTimelineImagePreviewLink({
        path: "assets/chart.png",
        workspaceRootPath: null,
      }),
    ).toBeNull();
  });

  it("routes a local workspace PNG to the workspace file preview", () => {
    expect(
      routeImage({
        hostFileLinksAvailable: true,
        path: "assets/chart.png",
        threadStorageRootPath: "/home/me/.bb/thread-storage/thr_one",
        workspaceRootPath,
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: null,
        path: "/home/me/project/assets/chart.png",
        relativePath: "assets/chart.png",
        workspaceRootPath,
      },
    });
  });

  it("routes a relative cloud PNG through the thread's sandbox checkout", () => {
    expect(
      routeImage({
        hostFileLinksAvailable: true,
        path: "out/render.png",
        relativeRootPath: "/code/app",
        threadStorageRootPath: null,
        workspaceRootPath: null,
      }),
    ).toEqual({
      kind: "open-host-path",
      request: { lineRange: null, path: "/code/app/out/render.png" },
    });
  });

  it("does not open a relative PNG before the cloud checkout is known", () => {
    expect(
      routeImage({
        hostFileLinksAvailable: true,
        path: "out/render.png",
        relativeRootPath: null,
        threadStorageRootPath: null,
        workspaceRootPath: null,
      }),
    ).toBeNull();
  });

  it("routes thread storage PNGs to thread storage", () => {
    expect(
      routeImage({
        hostFileLinksAvailable: true,
        path: "/home/me/.bb/thread-storage/thr_one/shots/a.png",
        threadStorageRootPath: "/home/me/.bb/thread-storage/thr_one",
        workspaceRootPath,
      }),
    ).toMatchObject({
      kind: "open-thread-storage-path",
      request: { relativePath: "shots/a.png" },
    });
  });

  it("never treats another thread's storage as this thread's storage", () => {
    const path = "/home/me/.bb/thread-storage/thr_two/shots/a.png";
    const args = {
      path,
      threadStorageRootPath: "/home/me/.bb/thread-storage/thr_one",
      workspaceRootPath,
    };

    expect(routeImage({ ...args, hostFileLinksAvailable: true })).toEqual({
      kind: "open-host-path",
      request: { lineRange: null, path },
    });
    expect(
      routeImage({ ...args, hostFileLinksAvailable: false }),
    ).toMatchObject({ kind: "error" });
  });

  it("opens other absolute PNGs on the thread's own host", () => {
    expect(
      routeImage({
        hostFileLinksAvailable: true,
        path: "/tmp/shot.png",
        threadStorageRootPath: null,
        workspaceRootPath,
      }),
    ).toEqual({
      kind: "open-host-path",
      request: { lineRange: null, path: "/tmp/shot.png" },
    });
  });
});

describe("resolveTimelineImagePreviewRootPath", () => {
  const environment = { id: "env_one", path: "/home/me/project" };
  const localThread = {
    environmentId: "env_one",
    executionTarget: "local",
    id: "thr_one",
  };

  it("uses the loaded thread's own workspace", () => {
    expect(
      resolveTimelineImagePreviewRootPath({
        activeThreadId: "thr_one",
        cloudWorkspacePath: null,
        environment,
        thread: localThread,
      }),
    ).toBe("/home/me/project");
  });

  it("has no root while the previous thread is still loaded", () => {
    expect(
      resolveTimelineImagePreviewRootPath({
        activeThreadId: "thr_two",
        cloudWorkspacePath: null,
        environment,
        thread: localThread,
      }),
    ).toBeNull();
  });

  it("ignores an environment that belongs to another thread", () => {
    expect(
      resolveTimelineImagePreviewRootPath({
        activeThreadId: "thr_one",
        cloudWorkspacePath: null,
        environment: { id: "env_two", path: "/home/me/other" },
        thread: localThread,
      }),
    ).toBeNull();
  });

  it("uses the sandbox checkout for cloud threads", () => {
    expect(
      resolveTimelineImagePreviewRootPath({
        activeThreadId: "thr_cloud",
        cloudWorkspacePath: "/code/app",
        environment: undefined,
        thread: {
          environmentId: null,
          executionTarget: "cloud",
          id: "thr_cloud",
        },
      }),
    ).toBe("/code/app");
  });

  it("never uses a cloud checkout for a local thread", () => {
    expect(
      resolveTimelineImagePreviewRootPath({
        activeThreadId: "thr_one",
        cloudWorkspacePath: "/code/app",
        environment: undefined,
        thread: { ...localThread, environmentId: null },
      }),
    ).toBeNull();
  });
});

describe("resolveOpenableTimelineImagePreviewLink", () => {
  it("keeps host-only PNGs plain when the thread has no host access", () => {
    expect(
      resolveOpenableTimelineImagePreviewLink({
        hostFileLinksAvailable: false,
        path: "/tmp/shot.png",
        relativeRootPath: null,
        threadStorageRootPath: null,
        workspaceRootPath: null,
      }),
    ).toBeNull();
  });

  it("still opens workspace PNGs without host access", () => {
    expect(
      resolveOpenableTimelineImagePreviewLink({
        hostFileLinksAvailable: false,
        path: "assets/chart.png",
        relativeRootPath: "/home/me/project",
        threadStorageRootPath: null,
        workspaceRootPath: "/home/me/project",
      }),
    ).toEqual({ lineRange: null, path: "/home/me/project/assets/chart.png" });
  });
});
