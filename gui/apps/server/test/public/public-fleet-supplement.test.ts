import { archiveThread, setProjectHidden } from "@cloudroom/db";
import {
  fleetSupplementResponseSchema,
  sidebarBootstrapResponseSchema,
} from "@cloudroom/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/fleet-supplement", () => {
  it("lists hidden plugin threads and archived threads without changing bootstrap", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const parent = seedThread(harness.deps, {
        projectId: project.id,
        title: "Parent",
      });
      const sideChat = seedThread(harness.deps, {
        projectId: project.id,
        title: "Side chat",
        sourceThreadId: parent.id,
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "hidden",
      });
      const worker = seedThread(harness.deps, {
        projectId: project.id,
        title: "Workflow worker",
        originPluginId: "workflows",
        visibility: "hidden",
      });
      const old = seedThread(harness.deps, {
        projectId: project.id,
        title: "Old",
      });
      archiveThread(harness.db, harness.deps.hub, old.id);

      const response = await harness.app.request("/api/v1/fleet-supplement");
      expect(response.status).toBe(200);
      const body = fleetSupplementResponseSchema.parse(
        await readJson(response),
      );
      expect(body.source).toBe("server");
      expect(body.hiddenThreads.map((thread) => thread.id).sort()).toEqual(
        [sideChat.id, worker.id].sort(),
      );
      const side = body.hiddenThreads.find(
        (thread) => thread.id === sideChat.id,
      );
      expect(side?.sourceThreadId).toBe(parent.id);
      expect(side?.parentThreadId).toBeNull();
      expect(body.archivedThreads).toEqual([]);
      expect(body.archivedCount).toBe(1);
      expect(body.archivedTruncated).toBe(false);

      const withArchive = fleetSupplementResponseSchema.parse(
        await readJson(
          await harness.app.request(
            "/api/v1/fleet-supplement?archived=include",
          ),
        ),
      );
      expect(withArchive.archivedThreads.map((thread) => thread.id)).toEqual([
        old.id,
      ]);
      expect(withArchive.archivedCount).toBe(1);
      expect(body.threadFields).toEqual({});
      expect(body.pendingFields).toEqual(
        expect.arrayContaining([
          "configuredExecution",
          "cloudSandboxState",
          "workflowLineage",
        ]),
      );

      const bootstrap = sidebarBootstrapResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/sidebar-bootstrap")),
      );
      const bootstrapIds = bootstrap.projects.flatMap((p) =>
        p.threads.map((t) => t.id),
      );
      expect(bootstrapIds).toContain(parent.id);
      expect(bootstrapIds).not.toContain(sideChat.id);
      expect(bootstrapIds).not.toContain(worker.id);
      expect(bootstrapIds).not.toContain(old.id);
    });
  });

  it("includes visible threads of hidden projects, keeps default visibility for other callers", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/hidden-project",
      });
      const visibleInHidden = seedThread(harness.deps, {
        projectId: project.id,
        title: "In hidden project",
      });
      setProjectHidden(harness.db, harness.deps.hub, project.id, true);

      const body = fleetSupplementResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/fleet-supplement")),
      );
      expect(body.hiddenThreads.map((thread) => thread.id)).toContain(
        visibleInHidden.id,
      );
      expect(body.extraProjects).toContainEqual({
        id: project.id,
        name: "Test Project",
        hidden: true,
      });

      const bootstrap = sidebarBootstrapResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/sidebar-bootstrap")),
      );
      expect(
        bootstrap.projects.flatMap((p) => p.threads.map((t) => t.id)),
      ).not.toContain(visibleInHidden.id);
    });
  });

  it("keeps the live refresh independent of archive size and caps the archive page", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      for (let index = 0; index < 205; index += 1) {
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          title: `Old ${index}`,
        });
        archiveThread(harness.db, harness.deps.hub, thread.id);
      }

      const live = fleetSupplementResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/fleet-supplement")),
      );
      expect(live.archivedThreads).toEqual([]);
      expect(live.archivedCount).toBe(205);

      const page = fleetSupplementResponseSchema.parse(
        await readJson(
          await harness.app.request(
            "/api/v1/fleet-supplement?archived=include",
          ),
        ),
      );
      expect(page.archivedThreads).toHaveLength(200);
      expect(page.archivedTruncated).toBe(true);
    });
  });
});
