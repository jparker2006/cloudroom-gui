const params = new URLSearchParams(location.search);
const layout = params.get("layout") === "b" ? "b" : "a";
const app = document.getElementById("app");
app.classList.replace("layout-a", `layout-${layout}`);
app.dataset.tab = params.get("tab") === "preview" ? "preview" : "chat";

const els = {
  sidebar: document.getElementById("sidebar"),
  header: document.getElementById("thread-header"),
  timeline: document.getElementById("timeline"),
  queue: document.getElementById("queue"),
  draft: document.getElementById("draft"),
  composer: document.getElementById("composer"),
  runState: document.getElementById("run-state"),
  finishTurn: document.getElementById("finish-turn"),
  address: document.getElementById("preview-address"),
  reload: document.getElementById("reload"),
  selectToggle: document.getElementById("select-toggle"),
  selectHint: document.getElementById("select-hint"),
  selectCancel: document.getElementById("select-cancel"),
  previewBody: document.getElementById("preview-body"),
  reviewSlot: document.getElementById(layout === "b" && innerWidth >= 900 ? "review-slot-chat" : "review-slot-preview"),
  toast: document.getElementById("toast"),
};

const debug = { rejected: [], invalidations: [], sends: 0, reviews: 0 };
debug.state = () => ({ previewId: preview?.previewId ?? null, generation: preview?.generation ?? null, nonce: selecting?.nonce ?? null });
window.__cr8 = debug;

let config = null;
let threadId = params.get("thread") ?? "thr_pricing";
const drafts = new Map([["thr_pricing", "Also tighten the footer spacing when you get a chance."]]);
let preview = null;
let selecting = null;
let selection = null;
const checks = new Map();
const readingPositions = new Map();
let timelineThreadId = null;

function confirmStillValid(nonce) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      checks.delete(nonce);
      resolve(false);
    }, 1500);
    checks.set(nonce, (ok) => {
      clearTimeout(timer);
      checks.delete(nonce);
      resolve(ok);
    });
    post({ type: "check", nonce });
  });
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function thread() {
  return config.threads.find((t) => t.id === threadId);
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function renderSidebar() {
  const groups = new Map();
  for (const t of config.threads) {
    if (!groups.has(t.projectName)) groups.set(t.projectName, []);
    groups.get(t.projectName).push(t);
  }
  els.sidebar.replaceChildren();
  for (const [name, threads] of groups) {
    const h = document.createElement("h2");
    h.textContent = name;
    els.sidebar.append(h);
    for (const t of threads) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.title;
      b.dataset.thread = t.id;
      b.setAttribute("aria-current", String(t.id === threadId));
      b.addEventListener("click", () => switchThread(t.id));
      els.sidebar.append(b);
    }
  }
}

function renderHeader() {
  const t = thread();
  els.header.replaceChildren();
  const dot = document.createElement("span");
  dot.className = `dot${t.running ? "" : " idle"}`;
  const project = document.createElement("span");
  project.className = "project";
  project.textContent = `${t.projectName} ›`;
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = t.title;
  els.header.append(dot, project, title);
  const other = config.threads.find((x) => x.id !== t.id);
  const sw = document.createElement("button");
  sw.type = "button";
  sw.id = "switch-thread";
  sw.className = "ghost";
  sw.style.marginLeft = "auto";
  sw.textContent = "Switch thread";
  sw.title = `Switch to ${other.projectName} › ${other.title}`;
  sw.addEventListener("click", () => switchThread(other.id));
  els.header.append(sw);
  els.runState.textContent = t.running ? "Agent is working · new messages queue" : "Idle";
  els.finishTurn.hidden = !t.running;
}

function rememberReadingPosition() {
  const el = els.timeline;
  if (timelineThreadId && el.clientHeight > 0) readingPositions.set(timelineThreadId, { top: el.scrollTop, atBottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 2 });
}

function restoreReadingPosition() {
  if (els.timeline.clientHeight === 0) return;
  const saved = readingPositions.get(timelineThreadId);
  els.timeline.scrollTop = !saved || saved.atBottom ? els.timeline.scrollHeight : saved.top;
}

async function renderTimeline() {
  const requestedThreadId = threadId;
  const log = await api("/api/log");
  if (requestedThreadId !== threadId) return;
  rememberReadingPosition();
  const t = thread();
  els.timeline.replaceChildren();
  const intro = [
    ["user", t.id === "thr_pricing" ? "Build the new pricing page and share the preview." : "Rewrite the onboarding guide."],
    ["agent", t.id === "thr_pricing" ? "Done. The pricing page is running on port 4300 and shared to your phone." : "Working on it."],
  ];
  for (const [who, text] of intro) addMessage(who, text, []);
  for (const m of log.messages.filter((m) => m.threadId === t.id)) addMessage("user", m.text, m.attachments);
  els.queue.replaceChildren();
  for (const q of log.queued.filter((m) => m.threadId === t.id)) {
    const row = document.createElement("div");
    row.className = "queued";
    const b = document.createElement("b");
    b.textContent = "Queued";
    row.append(b, q.text.split("\n").find((line) => line.trim()) ?? "");
    els.queue.append(row);
  }
  timelineThreadId = t.id;
  restoreReadingPosition();
}

function addMessage(who, text, attachments) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  for (const a of attachments) {
    const img = document.createElement("img");
    img.alt = "Attached element image";
    img.src = `/api/attachments/${a.path.match(/element-(\d+)/)[1]}`;
    div.append(img);
  }
  els.timeline.append(div);
}

function mountPreview() {
  const t = thread();
  els.previewBody.replaceChildren();
  preview = null;
  setSelecting(null);
  if (!t.preview) {
    els.address.textContent = "No shared preview";
    els.selectToggle.disabled = true;
    els.reload.disabled = true;
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "<strong>No preview for this thread</strong><span>Ask the agent to start a server and share its port.</span>";
    els.previewBody.append(empty);
    return;
  }
  const owner = t.preview.ownerThreadId && t.preview.ownerThreadId !== t.id ? config.threads.find((x) => x.id === t.preview.ownerThreadId) : null;
  const previewId = randomId();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  frame.title = `Preview of ${t.preview.label}`;
  frame.src = `${config.shareOrigin}${config.shellPath}/?path=${encodeURIComponent(params.get("path") ?? "/pricing")}`;
  frame.addEventListener("load", () => {
    frame.contentWindow.postMessage({ cr8: 1, type: "hello", previewId }, config.shareOrigin);
  });
  preview = { previewId, threadId: t.id, projectId: t.projectId, frame, generation: -1, path: null, ready: false, foreignOwner: owner };
  els.address.textContent = owner ? `${t.preview.label} · shared from “${owner.title}”` : `${t.preview.label} · shared`;
  els.selectToggle.disabled = true;
  els.reload.disabled = false;
  els.previewBody.append(frame);
}

function setSelecting(next) {
  selecting = next;
  els.selectToggle.setAttribute("aria-pressed", String(next !== null));
  els.selectHint.hidden = next === null || selection !== null;
}

function post(message) {
  preview?.frame.contentWindow?.postMessage({ cr8: 1, previewId: preview.previewId, ...message }, config.shareOrigin);
}

function startSelecting() {
  if (!preview?.ready) return;
  clearSelection();
  const nonce = randomId();
  setSelecting({ nonce, previewId: preview.previewId, threadId: preview.threadId, projectId: preview.projectId, generation: preview.generation });
  post({ type: "select:start", nonce });
}

function cancelSelecting() {
  if (selecting) post({ type: "select:cancel", nonce: selecting.nonce });
  clearSelection({ keepText: false });
  setSelecting(null);
  els.selectToggle.focus({ preventScroll: true });
}

const requestDrafts = new Map();

function announce(text) {
  const live = document.getElementById("sr-status");
  live.textContent = "";
  setTimeout(() => (live.textContent = text), 30);
}

function clearSelection({ keepText = true } = {}) {
  if (selection) {
    const text = selection.view.querySelector(".request-text").value;
    if (keepText && text.trim()) requestDrafts.set(selection.threadId, text);
    else requestDrafts.delete(selection.threadId);
  }
  const hadFocus = els.reviewSlot.contains(document.activeElement) || document.activeElement === preview?.frame;
  selection = null;
  els.reviewSlot.replaceChildren();
  if (selecting) els.selectHint.hidden = false;
  if (hadFocus && !els.selectToggle.disabled) els.selectToggle.focus({ preventScroll: true });
}

function invalidate(reason) {
  if (!selecting && !selection) return;
  debug.invalidations.push(reason);
  if (selecting) post({ type: "select:cancel", nonce: selecting.nonce });
  clearSelection();
  setSelecting(null);
  toast(reason);
  announce(reason);
}

window.addEventListener("message", async (event) => {
  if (!preview || event.origin !== config.shareOrigin || event.source !== preview.frame.contentWindow) return;
  const data = event.data;
  if (!data || data.cr8 !== 1 || data.previewId !== preview.previewId) return;
  if (data.type === "navigated") {
    preview.generation = data.generation;
    preview.path = data.path;
    preview.ready = !preview.foreignOwner;
    els.selectToggle.disabled = !preview.ready;
    els.selectToggle.title = preview.foreignOwner ? `This port was shared from “${preview.foreignOwner.title}” (${preview.foreignOwner.projectName}). Select from that thread.` : "";
    els.address.textContent = preview.foreignOwner ? `${thread().preview.label} · from “${preview.foreignOwner.title}”` : `${thread().preview.label} · ${data.path}`;
    invalidate("The preview changed. Select the element again.");
    return;
  }
  if (data.type === "unavailable") {
    preview.ready = false;
    els.selectToggle.disabled = true;
    els.address.textContent = `${thread().preview.label} · can't inspect`;
    invalidate(data.reason);
    return;
  }
  if (data.type === "checked") {
    const waiter = checks.get(data.nonce);
    if (waiter) waiter(data.valid === true && data.generation === preview.generation);
    return;
  }
  if (data.type === "select:busy" && selecting?.nonce === data.nonce) {
    els.selectHint.hidden = false;
    els.selectHint.querySelector("span").textContent = "Rendering the selected element…";
    return;
  }
  if (data.type === "select:list" && selecting?.nonce === data.nonce && Array.isArray(data.items)) {
    showCandidateList(data.items.slice(0, 60).map((item) => str(item, 80)));
    return;
  }
  if (data.type === "select:ended") {
    if (selecting?.nonce === data.nonce) {
      clearSelection();
      setSelecting(null);
    }
    return;
  }
  if (data.type === "select:result") {
    const current = thread();
    const stale =
      !selecting ||
      data.nonce !== selecting.nonce ||
      data.generation !== preview.generation ||
      selecting.generation !== preview.generation ||
      selecting.threadId !== current.id ||
      selecting.projectId !== current.projectId;
    if (stale) {
      debug.rejected.push({ nonce: data.nonce, generation: data.generation });
      return;
    }
    if (data.seq <= (selecting.latestSeq ?? 0)) return;
    selecting.latestSeq = data.seq;
    const safe = sanitizeResult(data);
    if (!safe) {
      debug.rejected.push({ nonce: data.nonce, invalid: true });
      return;
    }
    await showReview({ ...selecting, seq: data.seq, ...safe });
  }
});

const MAX_CROP_DATA_URL = 4 * 1024 * 1024;
const { clean } = globalThis.__cr8ElementContext;

function num(value, min = -100000, max = 100000) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function rect(value) {
  const r = { x: num(value?.x), y: num(value?.y), width: num(value?.width, 0), height: num(value?.height, 0) };
  return Object.values(r).every((v) => v !== null) ? r : null;
}

function str(value, max) {
  return typeof value === "string" ? clean(value, max) : "";
}

function sanitizeResult(data) {
  const e = data.element;
  if (!e || typeof e !== "object") return null;
  const box = rect(e.rect);
  const viewport = { width: num(e.viewport?.width, 1, 20000), height: num(e.viewport?.height, 1, 20000) };
  if (!box || viewport.width === null || viewport.height === null) return null;
  const source = e.sourceCandidate && typeof e.sourceCandidate.file === "string" && /^[\w./-]{1,200}$/.test(e.sourceCandidate.file) && !e.sourceCandidate.file.includes("..")
    ? { file: e.sourceCandidate.file, line: num(e.sourceCandidate.line, 1, 1000000) }
    : null;
  const style = {};
  for (const key of ["fontSize", "fontWeight", "color", "backgroundColor", "padding", "borderRadius"]) style[key] = str(e.style?.[key], 60);
  const element = {
    tag: /^[a-z][a-z0-9-]{0,40}$/.test(e.tag) ? e.tag : "element",
    role: typeof e.role === "string" && /^[a-z-]{1,30}$/.test(e.role) ? e.role : null,
    name: str(e.name, 120),
    text: str(e.text, 200),
    selector: str(e.selector, 300),
    path: typeof e.path === "string" && e.path.startsWith("/") ? str(e.path, 200) : "/",
    rect: box,
    viewport,
    style,
    sourceCandidate: source,
  };
  const c = data.crop;
  let crop;
  if (c?.kind === "rendered") {
    const target = rect(c.target);
    const scale = num(c.scale, 0.5, 4);
    const ok = typeof c.dataUrl === "string" && c.dataUrl.length < MAX_CROP_DATA_URL && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.dataUrl);
    crop = ok && target && scale !== null
      ? { kind: c.kind, dataUrl: c.dataUrl, target, scale, masks: Array.isArray(c.masks) ? c.masks.slice(0, 50).map(rect).filter(Boolean) : [] }
      : { kind: "unavailable", reason: "The image from the preview was invalid." };
  } else {
    crop = { kind: "unavailable", reason: c?.kind === "native" ? "The preview sent an image this channel can't vouch for." : str(c?.reason, 160) || "No image was available." };
  }
  return { element, crop };
}

async function verifySource(projectId, candidate) {
  if (!candidate) return null;
  try {
    const { verified } = await api(`/api/projects/${projectId}/verify-source`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: candidate.file }),
    });
    return { ...candidate, verified };
  } catch {
    return { ...candidate, verified: false };
  }
}

async function showReview(next) {
  const previousText = selection?.view.querySelector(".request-text").value ?? requestDrafts.get(next.threadId) ?? "";
  const source = next.element.sourceCandidate;
  if (!selecting || selecting.nonce !== next.nonce || selecting.latestSeq !== next.seq || !preview || preview.generation !== next.generation) return;
  const view = document.getElementById("review-template").content.firstElementChild.cloneNode(true);
  debug.reviews++;
  selection = { ...next, source, view, removed: new Set(), redactions: [], imageRemoved: next.crop.kind === "unavailable", image: null };
  els.selectHint.hidden = true;
  els.reviewSlot.replaceChildren(view);
  const t = thread();
  const target = view.querySelector(".review-target");
  target.innerHTML = "";
  const to = document.createElement("span");
  to.textContent = "To";
  const name = document.createElement("strong");
  name.textContent = `${t.projectName} › ${t.title}`;
  name.className = "target-name";
  const delivery = document.createElement("span");
  delivery.className = "delivery";
  delivery.textContent = t.running ? "Queues after turn" : "Sends now";
  target.append(to, name, delivery);
  view.querySelector(".request-text").value = previousText;
  view.querySelector('[data-action="send"]').textContent = t.running ? "Queue" : "Send";
  view.addEventListener("click", onReviewClick);
  renderChips();
  try {
    await renderCrop();
  } catch {
    if (selection?.view !== view) return;
    selection.crop = { kind: "unavailable", reason: "The image from the preview could not be read." };
    selection.imageRemoved = true;
    await renderCrop();
  }
  if (selection?.view !== view) return;
  announce(`${next.element.role ?? next.element.tag}${next.element.name ? ` ${next.element.name}` : ""} selected. Describe the change, then send.`);
  els.selectHint.querySelector("span").textContent = "Tap an element to choose it. Drag to scroll.";
  view.querySelector(".request-text").focus({ preventScroll: true });
  view.querySelector(".request-text").scrollIntoView({ block: "nearest" });
  revealSelection();
}

function revealSelection() {
  if (!selection) return;
  const body = els.previewBody.getBoundingClientRect();
  const sheet = els.reviewSlot.firstElementChild?.getBoundingClientRect();
  const covered = sheet && els.reviewSlot.id === "review-slot-preview" && getComputedStyle(els.reviewSlot.firstElementChild).position === "absolute" ? Math.max(0, body.bottom - sheet.top) : 0;
  post({ type: "select:reveal", nonce: selection.nonce, bottomInset: Math.round(covered) });
}

function chipItems() {
  const e = selection.element;
  const items = [
    ["element", `${e.role ?? e.tag}${e.name ? ` “${e.name}”` : ""}`],
    ["selector", e.selector],
  ];
  if (e.text) items.push(["text", `Text: ${e.text}`]);
  if (selection.source) items.push(["source", `${selection.source.file}${selection.source.line ? `:${selection.source.line}` : ""} · checked when sent`]);
  items.push(["page", `Page ${e.path}`]);
  items.push(["style", `${e.style.fontSize} · ${e.style.color}`]);
  return items;
}

function renderChips() {
  const list = selection.view.querySelector(".chips");
  list.replaceChildren();
  for (const [key, label] of chipItems()) {
    if (selection.removed.has(key)) continue;
    const li = document.createElement("li");
    li.dataset.key = key;
    const span = document.createElement("span");
    span.textContent = label;
    span.title = label;
    li.append(span);
    {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "remove-chip";
      remove.dataset.key = key;
      remove.setAttribute("aria-label", `Don't send ${key}`);
      remove.textContent = "×";
      li.append(remove);
    }
    list.append(li);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderCrop() {
  const { view, crop } = selection;
  const canvas = view.querySelector(".crop-canvas");
  const caption = view.querySelector(".crop-caption");
  const tools = view.querySelector(".crop-tools");
  if (selection.imageRemoved || crop.kind === "unavailable") {
    canvas.hidden = true;
    tools.querySelector('[data-action="redact"]').disabled = true;
    tools.querySelector('[data-action="remove-image"]').disabled = true;
    caption.textContent = crop.kind === "unavailable" ? `No image: ${crop.reason} Only element details will be sent.` : "Image removed. Only element details will be sent.";
    return;
  }
  if (!selection.image) selection.image = await loadImage(crop.dataUrl);
  const img = selection.image;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  drawCrop(canvas.getContext("2d"));
  const kind = crop.kind === "native" ? "Screenshot" : "Rendered";
  const detail = crop.kind === "native" ? "Captured from the preview." : "Rebuilt from page code; may differ slightly.";
  const hidden = crop.masks.length + selection.redactions.length;
  caption.innerHTML = "";
  const tagline = document.createElement("span");
  tagline.className = "tagline";
  tagline.textContent = kind;
  caption.append(tagline, `${detail}${hidden ? ` ${hidden} area${hidden === 1 ? "" : "s"} hidden.` : ""}`);
  tools.querySelector('[data-action="undo-redact"]').disabled = selection.redactions.length === 0;
}

function drawCrop(ctx) {
  const { crop } = selection;
  const s = crop.scale;
  ctx.drawImage(selection.image, 0, 0);
  ctx.strokeStyle = "#bfff00";
  ctx.lineWidth = 2 * s;
  ctx.strokeRect(crop.target.x * s, crop.target.y * s, crop.target.width * s, crop.target.height * s);
  ctx.fillStyle = "#111";
  for (const r of selection.redactions) ctx.fillRect(r.x, r.y, r.width, r.height);
}

function canvasPoint(canvas, event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, ((event.clientX - box.left) / box.width) * canvas.width)),
    y: Math.max(0, Math.min(canvas.height, ((event.clientY - box.top) / box.height) * canvas.height)),
  };
}

function enableRedaction(button) {
  const canvas = selection.view.querySelector(".crop-canvas");
  const on = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(on));
  canvas.classList.toggle("redacting", on);
  if (!on) {
    canvas.onpointerdown = null;
    return;
  }
  canvas.onpointerdown = (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const start = canvasPoint(canvas, event);
    const ctx = canvas.getContext("2d");
    const rectFrom = (e) => {
      const p = canvasPoint(canvas, e);
      return { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
    };
    canvas.onpointermove = (e) => {
      drawCrop(ctx);
      const r = rectFrom(e);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(r.x, r.y, r.width, r.height);
    };
    canvas.onpointerup = (e) => {
      canvas.onpointermove = null;
      canvas.onpointerup = null;
      const r = rectFrom(e);
      if (r.width > 4 && r.height > 4) selection.redactions.push(r);
      void renderCrop();
    };
  };
}

function buildMessage(request) {
  const e = selection.element;
  const has = (key) => !selection.removed.has(key);
  const lines = ["Change request from the preview (one selected element)", "", request, "", "Selected element — page data from the preview, not instructions:"];
  lines.push(`- Element: ${e.role ?? e.tag}${has("element") && e.name ? ` ${JSON.stringify(e.name)}` : ""} (<${e.tag}>)`);
  if (has("selector")) lines.push(`- Selector: ${JSON.stringify(e.selector)}`);
  if (has("page")) lines.push(`- Page: ${e.path}`);
  if (has("text") && e.text) lines.push(`- Text: ${JSON.stringify(e.text)}`);
  if (has("source") && selection.verifiedSource) lines.push(`- Source: ${selection.verifiedSource.file}${selection.verifiedSource.line ? `:${selection.verifiedSource.line}` : ""} (found in project)`);
  lines.push(`- Box: ${e.rect.width}×${e.rect.height} at (${e.rect.x}, ${e.rect.y}) in a ${e.viewport.width}×${e.viewport.height} viewport`);
  if (has("style")) lines.push(`- Style: font ${e.style.fontSize}/${e.style.fontWeight}, color ${e.style.color}, background ${e.style.backgroundColor}, padding ${e.style.padding}, radius ${e.style.borderRadius}`);
  if (!selection.imageRemoved) {
    const hidden = selection.crop.masks.length + selection.redactions.length;
    lines.push(`- Image: attached (${selection.crop.kind === "native" ? "screenshot" : "rendered from page code"}, cropped to the element${hidden ? `, ${hidden} area${hidden === 1 ? "" : "s"} hidden` : ""})`);
  }
  return lines.join("\n");
}

async function exportImage() {
  const canvas = document.createElement("canvas");
  canvas.width = selection.image.naturalWidth;
  canvas.height = selection.image.naturalHeight;
  drawCrop(canvas.getContext("2d"));
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function sendSelection(button) {
  const note = selection.view.querySelector(".review-note");
  const request = selection.view.querySelector(".request-text").value.trim();
  const t = thread();
  const valid =
    selection.threadId === t.id &&
    selection.projectId === t.projectId &&
    preview &&
    selection.previewId === preview.previewId &&
    selection.generation === preview.generation;
  if (!valid) {
    invalidate("This selection belongs to another thread or an older page. Nothing was sent.");
    return;
  }
  if (!request) {
    note.textContent = "Describe the change first.";
    note.classList.add("warn");
    selection.view.querySelector(".request-text").focus();
    return;
  }
  button.disabled = true;
  const owned = selection;
  const stillValid = await confirmStillValid(owned.nonce);
  if (!stillValid || selection !== owned || owned.generation !== preview?.generation) {
    if (selection === owned) invalidate("The preview changed before sending. Nothing was sent.");
    return;
  }
  try {
    owned.verifiedSource = null;
    if (owned.source && !owned.removed.has("source")) {
      const checked = await verifySource(owned.projectId, owned.source);
      owned.verifiedSource = checked?.verified ? checked : null;
    }
    const attachments = [];
    if (!owned.imageRemoved) {
      const blob = await exportImage();
      const uploaded = await api(`/api/projects/${owned.projectId}/attachments`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
      attachments.push(uploaded);
    }
    if (selection !== owned || thread().id !== owned.threadId || owned.generation !== preview?.generation) throw new Error("The thread or page changed before sending. Nothing was sent.");
    const result = await api(`/api/threads/${owned.threadId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: owned.projectId, text: buildMessage(request), attachments, mode: "queue-if-active" }),
    });
    debug.sends++;
    post({ type: "select:cancel", nonce: owned.nonce });
    clearSelection({ keepText: false });
    setSelecting(null);
    els.selectToggle.focus({ preventScroll: true });
    const done = result.delivery === "queued" ? "Queued — runs after the current turn" : `Sent to ${t.title}`;
    toast(done);
    announce(done);
    await renderTimeline();
  } catch (error) {
    if (selection === owned) {
      button.disabled = false;
      note.textContent = error.message;
      note.classList.add("warn");
    } else {
      toast(error.message);
    }
  }
}

function onReviewClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !selection) return;
  const action = button.dataset.action;
  if (action === "cancel") cancelSelecting();
  if (action === "send") void sendSelection(button);
  if (action === "parent" || action === "child") post({ type: "select:step", nonce: selection.nonce, direction: action });
  if (action === "remove-chip") {
    selection.removed.add(button.dataset.key);
    renderChips();
    (selection.view.querySelector(".chips button") ?? selection.view.querySelector(".request-text")).focus();
    announce(`${button.dataset.key} won't be sent.`);
  }
  if (action === "remove-image") {
    selection.imageRemoved = true;
    void renderCrop();
  }
  if (action === "redact") enableRedaction(button);
  if (action === "undo-redact") {
    selection.redactions.pop();
    void renderCrop();
  }
}

function switchThread(id) {
  if (id === threadId) return;
  rememberReadingPosition();
  drafts.set(threadId, els.draft.value);
  invalidate("Switched threads. The selection was cleared.");
  threadId = id;
  els.draft.value = drafts.get(id) ?? "";
  renderSidebar();
  renderHeader();
  void renderTimeline();
  mountPreview();
}

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.draft.value.trim();
  if (!text) return;
  const t = thread();
  await api(`/api/threads/${t.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: t.projectId, text, attachments: [], mode: "queue-if-active" }),
  });
  if (thread().id === t.id && els.draft.value.trim() === text) els.draft.value = "";
  drafts.set(t.id, "");
  await renderTimeline();
});

els.finishTurn.addEventListener("click", async () => {
  const t = thread();
  Object.assign(t, await api(`/api/threads/${t.id}/running`, { method: "POST", body: JSON.stringify({ running: false }) }));
  renderHeader();
  if (selection) selection.view.querySelector('[data-action="send"]').textContent = "Send";
  if (selection) selection.view.querySelector(".delivery").textContent = "Sends now";
  await renderTimeline();
});

els.selectToggle.addEventListener("click", () => (selecting ? cancelSelecting() : startSelecting()));
els.selectCancel.addEventListener("click", cancelSelecting);
els.reload.addEventListener("click", () => {
  invalidate("The preview reloaded. Select the element again.");
  mountPreview();
});
document.getElementById("mobile-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-tab]")?.dataset.tab;
  if (!tab) return;
  rememberReadingPosition();
  app.dataset.tab = tab;
  if (tab === "chat") restoreReadingPosition();
  for (const b of document.querySelectorAll("#mobile-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || (!selecting && !selection)) return;
  const typed = selection?.view.querySelector(".request-text").value.trim();
  if (typed) {
    const note = selection.view.querySelector(".review-note");
    note.textContent = "Your request is kept. Use Cancel to discard it.";
    return;
  }
  cancelSelecting();
});

function showCandidateList(items) {
  const list = document.getElementById("candidate-list");
  list.replaceChildren();
  list.hidden = false;
  items.forEach((item, index) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item;
    b.addEventListener("click", () => {
      list.hidden = true;
      post({ type: "select:pick", nonce: selecting?.nonce, index });
    });
    li.append(b);
    list.append(li);
  });
  list.querySelector("button")?.focus();
}

document.getElementById("select-list").addEventListener("click", () => {
  if (selecting) post({ type: "select:list", nonce: selecting.nonce });
});

const chromeObserver = new ResizeObserver(() => {
  const h = document.getElementById("thread-header").offsetHeight + document.getElementById("mobile-tabs").offsetHeight;
  app.style.setProperty("--chrome-h", `${h}px`);
});
chromeObserver.observe(document.getElementById("thread-header"));
chromeObserver.observe(document.getElementById("mobile-tabs"));

config = await api("/api/state");
els.draft.value = drafts.get(threadId) ?? "";
for (const b of document.querySelectorAll("#mobile-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === app.dataset.tab));
renderSidebar();
renderHeader();
await renderTimeline();
mountPreview();
