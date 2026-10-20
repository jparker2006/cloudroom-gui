import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.CR8_HOST ?? "127.0.0.1";
const APP_PORT = Number(process.env.CR8_APP_PORT ?? 4300);
const SHARE_PORT = Number(process.env.CR8_SHARE_PORT ?? 4301);
const ROOM_PORT = Number(process.env.CR8_ROOM_PORT ?? 4302);
const PUBLIC_HOST = process.env.CR8_PUBLIC_HOST ?? "localhost";
const ROOM_ORIGIN = process.env.CR8_ROOM_ORIGIN ?? `http://${PUBLIC_HOST}:${ROOM_PORT}`;
const SHARE_ORIGIN = process.env.CR8_SHARE_ORIGIN ?? `http://${PUBLIC_HOST}:${SHARE_PORT}`;
const SHELL_PATH = "/.well-known/cloudroom/select";
const MAX_UPLOAD = 2 * 1024 * 1024;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function serveFile(res, dir, path, extraHeaders = {}) {
  const file = normalize(join(dir, path));
  if (!file.startsWith(dir) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found\n");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, {
    "content-type": types[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(await readFile(file));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

const fixtureDir = join(root, "fixture");
const appServer = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname === "/" || url.pathname === "/pricing") return serveFile(res, fixtureDir, "index.html");
  if (url.pathname === "/about") return serveFile(res, fixtureDir, "about.html");
  if (url.pathname === "/framed-deny") {
    res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY", "cache-control": "no-store" });
    res.end("<!doctype html><title>Denied</title><h1>Frame denied</h1>");
    return;
  }
  return serveFile(res, fixtureDir, url.pathname);
});

const shellDir = join(root, "shell");
const shareServer = createServer(async (req, res) => {
  const url = new URL(req.url, SHARE_ORIGIN);
  if (url.pathname === SHELL_PATH || url.pathname.startsWith(`${SHELL_PATH}/`)) {
    const rest = url.pathname.slice(SHELL_PATH.length) || "/index.html";
    if (rest === "/index.html" || rest === "/") {
      const html = (await readFile(join(shellDir, "index.html"), "utf8")).replace(
        "__CLOUDROOM_APP_ORIGIN__",
        JSON.stringify(ROOM_ORIGIN).slice(1, -1),
      );
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `frame-ancestors ${ROOM_ORIGIN}; default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'self'; script-src 'self'`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      res.end(html);
      return;
    }
    if (rest === "/element-context.js") return serveFile(res, join(root, "shared"), rest, { "x-content-type-options": "nosniff" });
    return serveFile(res, shellDir, rest, { "x-content-type-options": "nosniff" });
  }
  const upstream = httpRequest(
    { host: "127.0.0.1", port: APP_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${APP_PORT}` } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end("Preview offline\n"));
  req.pipe(upstream);
});

const roomDir = join(root, "room");
const state = {
  threads: [
    { id: "thr_pricing", projectId: "prj_acme", projectName: "Acme Web", title: "Polish pricing page", running: true, preview: { port: APP_PORT, label: `Port ${APP_PORT}` } },
    { id: "thr_docs", projectId: "prj_docs", projectName: "Docs Site", title: "Rewrite onboarding", running: false, preview: null },
  ],
  messages: [],
  queued: [],
  uploads: [],
  workspaceFiles: new Set(["src/components/PricingCard.tsx", "src/components/Hero.tsx"]),
};

const roomServer = createServer(async (req, res) => {
  const url = new URL(req.url, ROOM_ORIGIN);
  if (url.pathname === "/api/state") {
    return json(res, 200, { threads: state.threads, shareOrigin: SHARE_ORIGIN, shellPath: SHELL_PATH });
  }
  if (url.pathname === "/api/log") {
    return json(res, 200, { messages: state.messages, queued: state.queued, uploads: state.uploads.map(({ bytes, ...rest }) => rest) });
  }
  if (url.pathname === "/api/reset" && req.method === "POST") {
    state.messages = [];
    state.queued = [];
    state.uploads = [];
    state.threads[0].running = true;
    return json(res, 200, { ok: true });
  }
  const running = /^\/api\/threads\/([^/]+)\/running$/.exec(url.pathname);
  if (running && req.method === "POST") {
    const thread = state.threads.find((t) => t.id === running[1]);
    if (!thread) return json(res, 404, { error: "thread" });
    thread.running = JSON.parse((await readBody(req, 1024)).toString()).running === true;
    if (!thread.running) {
      const next = state.queued.filter((q) => q.threadId === thread.id);
      state.queued = state.queued.filter((q) => q.threadId !== thread.id);
      for (const q of next) state.messages.push({ ...q, deliveredFromQueue: true });
    }
    return json(res, 200, thread);
  }
  const verify = /^\/api\/projects\/([^/]+)\/verify-source$/.exec(url.pathname);
  if (verify && req.method === "POST") {
    const { file } = JSON.parse((await readBody(req, 4096)).toString());
    const ok = typeof file === "string" && /^[\w./-]{1,200}$/.test(file) && !file.includes("..") && verify[1] === "prj_acme" && state.workspaceFiles.has(file);
    return json(res, 200, { verified: ok });
  }
  const upload = /^\/api\/projects\/([^/]+)\/attachments$/.exec(url.pathname);
  if (upload && req.method === "POST") {
    if (req.headers["content-type"] !== "image/png") return json(res, 415, { error: "png only" });
    try {
      const bytes = await readBody(req, MAX_UPLOAD);
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!isPng) return json(res, 400, { error: "not png" });
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const path = `.cloudroom/attachments/element-${state.uploads.length + 1}.png`;
      state.uploads.push({ projectId: upload[1], path, size: bytes.length, width, height, bytes });
      return json(res, 200, { path, name: "element.png" });
    } catch {
      return json(res, 413, { error: "too large" });
    }
  }
  const attachment = /^\/api\/attachments\/(\d+)$/.exec(url.pathname);
  if (attachment) {
    const item = state.uploads[Number(attachment[1]) - 1];
    if (!item) return json(res, 404, {});
    res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(item.bytes);
    return;
  }
  const send = /^\/api\/threads\/([^/]+)\/messages$/.exec(url.pathname);
  if (send && req.method === "POST") {
    const thread = state.threads.find((t) => t.id === send[1]);
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString());
    if (!thread || body.projectId !== thread.projectId) return json(res, 409, { error: "Thread or project mismatch." });
    if (body.mode !== "queue-if-active") return json(res, 400, { error: "Only queue-if-active is allowed." });
    const entry = { threadId: thread.id, projectId: thread.projectId, text: body.text, attachments: body.attachments ?? [], at: Date.now() };
    if (thread.running) {
      state.queued.push(entry);
      return json(res, 200, { delivery: "queued" });
    }
    state.messages.push(entry);
    return json(res, 200, { delivery: "sent" });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, roomDir, "index.html");
  if (url.pathname === "/element-context.js") return serveFile(res, join(root, "shared"), "element-context.js");
  return serveFile(res, roomDir, url.pathname);
});

appServer.listen(APP_PORT, HOST);
shareServer.listen(SHARE_PORT, HOST);
roomServer.listen(ROOM_PORT, HOST, () => {
  console.log(`fixture app   http://${HOST}:${APP_PORT}`);
  console.log(`share + shell ${SHARE_ORIGIN}${SHELL_PATH}`);
  console.log(`cloudroom     ${ROOM_ORIGIN}`);
});
