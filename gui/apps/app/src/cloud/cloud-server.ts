import { appToast } from "@/components/ui/app-toast";
import { wsManager } from "@/lib/ws";
import { cloudApi, SignedOutError, type CloudThreadSummary } from "./cloud-api";
import { PRE_TRANSPORT_REFUSAL_CODE } from "@/lib/send-delivery";
import { macOffline } from "./cloud-mode";
import {
  CloudThreadEvents,
  cloudTimelineRows,
  cloudTurnDetails,
  type CompletedTurnDisplay,
} from "./cloud-timeline";

type Json = Record<string, unknown>;
type ThreadEntry = Json & {
  id: string;
  projectId: string;
  title?: string | null;
  providerId?: string;
};
type Project = Json & { id: string; threads: ThreadEntry[] };
type Sidebar = Json & { projects: Project[]; personalProject: Project };

const THREAD = /^\/api\/v1\/threads\/(thr_[a-z0-9]+)(\/.*)?$/;
const CLOUD_THREAD = /^\/api\/v1\/cloudroom\/threads\/(thr_[a-z0-9]+)(\/.*)?$/;
const LIST_TTL_MS = 30_000;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const empty = () => new Response(null, { status: 204 });
const object = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

class CloudThread {
  readonly events: CloudThreadEvents;
  private ready: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private delay = 2000;
  private announced = 0;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly id: string,
    private readonly changed: (id: string) => void,
  ) {
    this.events = new CloudThreadEvents(id);
  }

  loaded(): Promise<void> {
    this.ready ??= this.load();
    return this.ready;
  }

  async load(): Promise<void> {
    const history = await cloudApi.history(this.id, this.events.cursor);
    if (this.events.add(history.records)) this.announce();
    if (history.awake) this.listen(true);
  }

  listen(restart = false) {
    if (this.unlisten && !restart) return;
    this.pause();
    this.unlisten = cloudApi.listen(this.id, this.events.cursor, {
      open: () => {
        this.delay = 2000;
      },
      records: (records) => {
        if (this.events.add(records)) this.announce();
      },
      asleep: () => {
        this.unlisten = null;
      },
      error: () => {
        this.unlisten = null;
        if (document.visibilityState !== "visible") return;
        this.retry = setTimeout(() => this.listen(), this.delay);
        this.delay = Math.min(this.delay * 2, 30_000);
      },
    });
  }

  pause() {
    clearTimeout(this.retry);
    this.unlisten?.();
    this.unlisten = null;
  }

  private announce() {
    const now = Date.now();
    if (now - this.announced < 250) {
      clearTimeout(this.announceTimer);
      this.announceTimer = setTimeout(() => this.announce(), 250);
      return;
    }
    this.announced = now;
    this.changed(this.id);
  }
}

class CloudServer {
  private readonly threads = new Map<string, CloudThread>();
  private readonly readAt = new Map<string, number>();
  private list: { at: number; value: Promise<CloudThreadSummary[]> } | null =
    null;

  constructor(private readonly network: typeof fetch) {}

  install() {
    macUnreachableThroughRelay = true;
    const network = this.network;
    window.fetch = (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        url.origin !== window.location.origin ||
        !url.pathname.startsWith("/api/v1/")
      ) {
        return network(input, init);
      }
      return this.handle(request, url).catch((failure: unknown) => {
        if (failure instanceof SignedOutError) window.location.reload();
        return json(
          {
            message:
              failure instanceof Error
                ? failure.message
                : "Cloudroom is unreachable.",
          },
          503,
        );
      });
    };
    wsManager.runWithoutSocket();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        for (const thread of this.threads.values()) thread.pause();
        return;
      }
      checkMacAgain();
      this.list = null;
      for (const thread of this.threads.values())
        void thread.load().catch(() => undefined);
    });
    appToast.message("Your Mac is offline. Showing your Cloud threads.");
  }

  private async handle(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const thread = THREAD.exec(path);
    const cloudThread = CLOUD_THREAD.exec(path);
    if (request.method === "GET") {
      if (path === "/api/v1/sidebar-bootstrap")
        return json(await this.sidebar());
      if (thread) return this.threadGet(thread[1], thread[2] ?? "", url);
      if (cloudThread)
        return this.cloudThreadGet(cloudThread[1], cloudThread[2] ?? "");
      return this.network(request);
    }
    if (thread && thread[2] === "/send") {
      const body = object(await request.json().catch(() => null));
      const parts = (Array.isArray(body.input) ? body.input : []).map(object);
      if (parts.some((part) => part.type !== "text"))
        return json(
          { code: PRE_TRANSPORT_REFUSAL_CODE, message: "Only text messages work while your Mac is off." },
          400,
        );
      const text = parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("\n")
        .trim();
      if (!text)
        return json(
          { code: PRE_TRANSPORT_REFUSAL_CODE, message: "Only text messages work while your Mac is off." },
          400,
        );
      await cloudApi.send(thread[1], text);
      this.thread(thread[1]).listen();
      return json({ ok: true, delivery: "sent" });
    }
    if (thread && (thread[2] === "/read" || thread[2] === "/unread")) {
      this.readAt.set(thread[1], thread[2] === "/read" ? Date.now() : 0);
      return this.threadGet(thread[1], "", url);
    }
    if (thread && thread[2] === "/stop") {
      await cloudApi.stop(thread[1]);
      return empty();
    }
    if (path === "/api/v1/threads" && request.method === "POST") {
      return json(
        { message: "Starting a new thread needs your Mac for now." },
        503,
      );
    }
    return empty();
  }

  private thread(id: string): CloudThread {
    let thread = this.threads.get(id);
    if (!thread) {
      thread = new CloudThread(id, (changed) =>
        wsManager.handleIncomingMessage(
          JSON.stringify({
            type: "changed",
            entity: "thread",
            id: changed,
            changes: ["events-appended", "status-changed"],
          }),
        ),
      );
      this.threads.set(id, thread);
    }
    return thread;
  }

  private live(entry: ThreadEntry): ThreadEntry {
    const status = this.status(entry.id);
    const readAt = this.readAt.get(entry.id);
    return {
      ...entry,
      status,
      runtime: { displayStatus: status, hostReconnectGraceExpiresAt: null },
      ...(readAt === undefined ? {} : { lastReadAt: readAt }),
    };
  }

  private status(id: string): "active" | "idle" {
    return this.threads.get(id)?.events.working ? "active" : "idle";
  }

  private cloudThreads(): Promise<CloudThreadSummary[]> {
    if (!this.list || Date.now() - this.list.at > LIST_TTL_MS) {
      const value = cloudApi.threads();
      this.list = { at: Date.now(), value };
      value.catch(() => {
        this.list = null;
      });
    }
    return this.list.value;
  }

  private async saved(path: string): Promise<Json | null> {
    const response = await this.network(path).catch(() => null);
    if (!response?.ok) return null;
    const value: unknown = await response.json().catch(() => null);
    return value !== null && typeof value === "object" ? (value as Json) : null;
  }

  private async sidebar(): Promise<Sidebar> {
    const [saved, cloud] = await Promise.all([
      this.saved("/api/v1/sidebar-bootstrap"),
      this.cloudThreads(),
    ]);
    const ids = new Set(cloud.map((thread) => thread.thread_id));
    const live = (entry: ThreadEntry): ThreadEntry => this.live(entry);
    if (saved) {
      const sidebar = saved as Sidebar;
      const keep = (project: Project): Project => ({
        ...project,
        threads: project.threads.filter((entry) => ids.has(entry.id)).map(live),
      });
      return {
        ...sidebar,
        sections: [],
        projects: sidebar.projects.map(keep),
        personalProject: keep(sidebar.personalProject),
      };
    }
    const projects = new Map<string, Project>();
    for (const thread of cloud) {
      const projectId = thread.project_id ?? "proj_personal";
      const at = thread.woke_at ? Date.parse(thread.woke_at) : 0;
      if (!projects.has(projectId)) {
        projects.set(projectId, {
          id: projectId,
          kind: projectId === "proj_personal" ? "personal" : "standard",
          name: thread.project_name ?? "Personal",
          gitRemoteUrl: null,
          createdAt: 0,
          updatedAt: 0,
          sources: [],
          defaultExecutionOptions: null,
          threads: [],
        });
      }
      projects.get(projectId)!.threads.push(
        live({
          id: thread.thread_id,
          projectId,
          environmentId: null,
          providerId: "claude-code",
          title: thread.title,
          titleFallback: null,
          sectionId: null,
          status: "idle",
          parentThreadId: null,
          sourceThreadId: null,
          originKind: null,
          originPluginId: null,
          visibility: "visible",
          archivedAt: null,
          pinnedAt: null,
          deletedAt: null,
          lastReadAt: Date.now(),
          latestAttentionAt: at,
          createdAt: at,
          updatedAt: at,
          queuedWork: "none",
          pinSortKey: null,
          hasPendingInteraction: false,
          activity: {
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activeGoalCount: 0,
            activePlanModeCount: 0,
            activeWorkflowCount: 0,
          },
          environmentBranchName: null,
          environmentHostId: null,
          environmentName: null,
          environmentPath: null,
          environmentProviderId: null,
          environmentIsWorktree: false,
          environmentWorkspaceDisplayKind: "other",
        }),
      );
    }
    const personal = projects.get("proj_personal") ?? {
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
      gitRemoteUrl: null,
      createdAt: 0,
      updatedAt: 0,
      sources: [],
      defaultExecutionOptions: null,
      threads: [],
    };
    projects.delete("proj_personal");
    return {
      sections: [],
      projects: [...projects.values()],
      personalProject: personal,
    };
  }

  private async entry(id: string): Promise<ThreadEntry | null> {
    const saved = await this.saved(`/api/v1/threads/${id}`);
    if (saved) return saved as ThreadEntry;
    const sidebar = await this.sidebar();
    return (
      [sidebar.personalProject, ...sidebar.projects]
        .flatMap((project) => project.threads)
        .find((entry) => entry.id === id) ?? null
    );
  }

  private async turnDisplay(
    providerId: string | undefined,
  ): Promise<CompletedTurnDisplay> {
    const [config, providers] = await Promise.all([
      this.saved("/api/v1/system/config"),
      this.saved("/api/v1/system/providers"),
    ]);
    const chosen = object(
      object(object(config).generalSettings).providerCompletedTurnDisplay,
    )[providerId ?? ""];
    const list = Array.isArray(providers)
      ? providers
      : Array.isArray(object(providers).providers)
        ? (object(providers).providers as unknown[])
        : [];
    const fallback = list
      .map(object)
      .find((provider) => provider.id === providerId)?.completedTurnDisplay;
    const display = chosen ?? fallback;
    return display === "flat" || display === "collapse" ? display : "collapse";
  }

  private async threadGet(
    id: string,
    rest: string,
    url: URL,
  ): Promise<Response> {
    if (rest === "") {
      const entry = await this.entry(id);
      if (!entry) return json({ message: "Thread not found." }, 404);
      return json(
        this.live({
          activeBackgroundAgentCount: 0,
          canSpawnChild: false,
          executionTarget: "cloud",
          projectCopy: null,
          queuedMessageCount: 0,
          ...entry,
        }),
      );
    }
    if (rest === "/timeline" || rest === "/timeline/turn-summary-details") {
      const thread = this.thread(id);
      await thread.loaded();
      const entry = await this.entry(id);
      const title = (entry?.title as string | null | undefined) ?? "";
      const display = await this.turnDisplay(entry?.providerId);
      if (rest === "/timeline/turn-summary-details") {
        const rows = cloudTurnDetails(thread.events, title, display, {
          turnId: url.searchParams.get("turnId") ?? "",
          sourceSeqStart: Number(url.searchParams.get("sourceSeqStart")),
          sourceSeqEnd: Number(url.searchParams.get("sourceSeqEnd")),
        });
        return rows
          ? json({
              rows,
              olderCursor: null,
              historySnapshot: `cloud:${thread.events.cursor}`,
            })
          : json({ message: "Turn not found." }, 404);
      }
      const rows = cloudTimelineRows(thread.events, title, display);
      const maxSeq = thread.events.events.length;
      const status = this.status(id);
      return json({
        maxSeq,
        rows,
        contextBoundarySeq: null,
        completedTurnDisplay: display,
        activePromptMode: null,
        activeThinking: null,
        activeWorkflows: [],
        activeBackgroundCommands: [],
        pendingTodos: null,
        goal: null,
        modelFallback: null,
        contextWindowUsage: null,
        timelinePage: {
          kind: "latest",
          segmentLimit: 20,
          returnedSegmentCount: rows.length,
          hasOlderRows: false,
          olderCursor: null,
          historySnapshot: JSON.stringify({
            version: 1,
            threadId: id,
            maxSeq,
            status,
          }),
          olderRowsSourceSeqEnd: null,
        },
      });
    }
    if (rest === "/interactions" || rest === "/queued-messages")
      return json([]);
    if (rest === "/tabs")
      return json(
        (await this.saved(`/api/v1/threads/${id}/tabs`)) ?? {
          revision: 0,
          tabs: [],
        },
      );
    return json({ message: "Not available while your Mac is off." }, 404);
  }

  private async cloudThreadGet(id: string, rest: string): Promise<Response> {
    const saved = await this.saved(`/api/v1/cloudroom/threads/${id}${rest}`);
    if (rest === "") {
      return json({
        authRequired: false,
        starting: false,
        sessionId: null,
        paused: false,
        failedStart: false,
        model: "",
        reasoning: "high",
        serviceTier: "default",
        error: null,
        reconnecting: false,
        usageLimit: false,
        diskFull: false,
        pendingDelivery: 0,
        ...saved,
      });
    }
    if (rest === "/share") return json(saved);
    return saved
      ? json(saved)
      : json({ message: "Not available while your Mac is off." }, 404);
  }
}

let macUnreachableThroughRelay = false;

export function isMacUnreachableThroughRelay(): boolean {
  return macUnreachableThroughRelay;
}

export function checkMacAgain(): void {
  void macOffline().then((offline) => {
    if (!offline) window.location.reload();
  });
}

export function installCloudServer(): void {
  new CloudServer(window.fetch.bind(window)).install();
}
