import { describe, expect, it } from "vitest";
import {
  resolveThreadLocalFileLink,
  resolveTimelineImagePreviewRootPath,
  resolveTimelineImagePreviewTarget,
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

describe("resolveTimelineImagePreviewTarget", () => {
  const workspace = "/home/me/project";
  const storage = "/home/me/.bb/thread-storage/thr_one";
  const local = {
    cwd: null,
    isCloudThread: false,
    threadStorageRootPath: storage,
    workspaceRootPath: workspace,
  };
  const cloud = {
    cwd: null,
    isCloudThread: true,
    threadStorageRootPath: null,
    workspaceRootPath: "/code/app",
  };
  const resolve = (
    context: typeof local | typeof cloud,
    path: string,
    cwd: string | null = null,
  ) => resolveTimelineImagePreviewTarget({ ...context, cwd, path });

  describe("allows only this thread's own files", () => {
    it.each([
      [
        "absolute workspace PNG",
        "/home/me/project/assets/Chart.PNG",
        null,
        "assets/Chart.PNG",
      ],
      [
        "command-relative PNG inside the workspace",
        "../shots/a.png",
        "/home/me/project/sub",
        "shots/a.png",
      ],
    ])("%s opens in the workspace preview", (_label, path, cwd, relative) => {
      expect(resolve(local, path, cwd)).toEqual({
        kind: "workspace",
        path: `${workspace}/${relative}`,
      });
    });

    it("opens this thread's storage in the storage preview", () => {
      expect(resolve(local, `${storage}/shots/a.png`)).toEqual({
        kind: "thread-storage",
        path: `${storage}/shots/a.png`,
        relativePath: "shots/a.png",
      });
    });

    it("opens a cloud checkout PNG through the thread's own sandbox", () => {
      expect(resolve(cloud, "out/render.png", "/code/app")).toEqual({
        kind: "workspace",
        path: "/code/app/out/render.png",
      });
    });
  });

  describe("rejects other files with a clear reason", () => {
    it.each([
      ["another thread's storage", local, "/home/me/.bb/thread-storage/thr_two/a.png", null],
      ["the thread storage folder itself", local, "/home/me/.bb/thread-storage/a.png", null],
      ["an absolute host path", local, "/tmp/shot.png", null],
      ["traversal out of the workspace", local, "../../etc/x.png", "/home/me/project/sub"],
      ["a bare relative path with no folder", local, "assets/chart.png", null],
      ["a cloud path outside the checkout", cloud, "/tmp/shot.png", null],
      ["cloud traversal out of the checkout", cloud, "../x.png", "/code/app"],
      ["a bare relative cloud path", cloud, "out/render.png", null],
    ])("%s", (_label, context, path, cwd) => {
      expect(resolve(context, path, cwd)).toMatchObject({ kind: "rejected" });
    });

    it("names another thread's storage in the reason", () => {
      expect(
        resolve(local, "/home/me/.bb/thread-storage/thr_two/a.png"),
      ).toEqual({
        kind: "rejected",
        reason: "This image belongs to another thread's storage.",
      });
    });

    it("fails closed while this thread's roots are unknown", () => {
      const path = `${workspace}/assets/chart.png`;
      expect(
        resolveTimelineImagePreviewTarget({
          ...local,
          path,
          threadStorageRootPath: null,
        }),
      ).toMatchObject({ kind: "rejected" });
      expect(
        resolveTimelineImagePreviewTarget({
          ...cloud,
          path: "/code/app/a.png",
          workspaceRootPath: null,
        }),
      ).toMatchObject({ kind: "rejected" });
    });

    it("keeps other threads' storage out when the workspace contains all thread storage", () => {
      const home = { ...local, workspaceRootPath: "/home/me" };
      expect(resolve(home, "/home/me/project/a.png")).toEqual({
        kind: "workspace",
        path: "/home/me/project/a.png",
      });
      expect(
        resolve(home, "/home/me/.bb/thread-storage/thr_two/a.png"),
      ).toMatchObject({ kind: "rejected" });
      expect(resolve(home, `${storage}/a.png`)).toMatchObject({
        kind: "thread-storage",
      });
    });

    it("prefers this thread's storage when it sits inside the workspace", () => {
      const nested = {
        ...local,
        threadStorageRootPath: "/home/me/project/.bb/thread-storage/thr_one",
      };
      expect(
        resolve(nested, "/home/me/project/.bb/thread-storage/thr_one/a.png"),
      ).toMatchObject({ kind: "thread-storage", relativePath: "a.png" });
      expect(
        resolve(nested, "/home/me/project/.bb/thread-storage/thr_two/a.png"),
      ).toMatchObject({ kind: "rejected" });
    });
  });

  describe("keeps unsafe paths plain text", () => {
    it.each([
      ["home-relative paths", "~/Desktop/shot.png", null],
      ["home-relative paths with a cwd", "~/Desktop/shot.png", "/home/me/project"],
      ["file URLs", "file:///tmp/shot.png", null],
      ["URL-shaped paths with a cwd", "https://example.com/a.png", "/home/me/project"],
      ["Windows paths", "C:\\Users\\me\\shot.png", null],
      ["backslash separators", "assets\\..\\shot.png", "/home/me/project"],
      ["control characters", "/home/me/project/a\u0000.png", null],
      ["newlines", "/home/me/project/a\n.png", null],
      ["bidi overrides", "/home/me/project/a\u202Egnp.png", null],
      ["bidi isolates", "/home/me/project/\u2066a\u2069.png", null],
      ["Arabic letter marks", "/home/me/project/\u061Ca.png", null],
      ["zero-width characters", "/home/me/project/a\u200B.png", null],
      ["byte order marks", "\uFEFF/home/me/project/a.png", null],
      ["line separators", "/home/me/project/a\u2028.png", null],
      ["unsafe cwd characters", "a.png", "/home/me/pro\u202Eject"],
      ["relative cwds", "a.png", "project"],
      ["non-PNG files", "/home/me/project/notes.txt", null],
      ["app routes", "/settings/general.png", null],
    ])("%s", (_label, path, cwd) => {
      expect(resolve(local, path, cwd)).toBeNull();
    });
  });
});
