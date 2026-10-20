const { app, BrowserWindow, WebContentsView, nativeImage, desktopCapturer } = require("electron");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const FIXTURE = process.env.CR8_FIXTURE ?? "http://127.0.0.1:4300/pricing";
const OUT = join(__dirname, "..", "out");
const CONTEXT_SOURCE = readFileSync(join(__dirname, "..", "shared", "element-context.js"), "utf8");
const PAD = 16;

mkdirSync(OUT, { recursive: true });

function createSelector(contents) {
  const dbg = contents.debugger;
  let generation = 0;
  let pending = null;
  let owns = false;
  let listener = null;
  const clearListener = () => {
    if (listener) dbg.off("message", listener);
    listener = null;
  };
  const bump = () => {
    generation++;
    if (pending) pending.reject(new Error("stale: page changed"));
    pending = null;
    clearListener();
  };
  dbg.on("detach", () => {
    owns = false;
    clearListener();
    if (pending) pending.reject(new Error("cancelled: debugger detached"));
    pending = null;
  });
  contents.on("did-start-navigation", (_e, _url, isInPlace, isMainFrame) => isMainFrame && bump());
  contents.on("did-navigate-in-page", (_e, _url, isMainFrame) => isMainFrame && bump());
  contents.on("render-process-gone", bump);

  const send = (method, params, sessionId) => dbg.sendCommand(method, params, sessionId);

  async function start() {
    if (dbg.isAttached()) throw new Error("busy: an agent is controlling this tab");
    dbg.attach("1.3");
    owns = true;
    try {
      await send("DOM.enable");
      await send("DOM.getDocument", { depth: 0 });
      await send("Overlay.enable");
      await send("Page.enable");
      await send("Runtime.enable");
    } catch (error) {
      stop();
      throw error;
    }
    const startedAt = generation;
    const picked = new Promise((resolve, reject) => {
      pending = { resolve, reject, startedAt };
    });
    clearListener();
    listener = (_event, method, params) => {
      if (method !== "Overlay.inspectNodeRequested") return;
      clearListener();
      if (!pending) return;
      if (pending.startedAt !== generation) {
        pending.reject(new Error("stale: page changed"));
        pending = null;
        return;
      }
      pending.resolve({ backendNodeId: params.backendNodeId, generation });
      pending = null;
    };
    dbg.on("message", listener);
    await send("Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: { showInfo: true, contentColor: { r: 191, g: 255, b: 0, a: 0.18 }, borderColor: { r: 191, g: 255, b: 0, a: 1 } },
    });
    return { picked, startedAt };
  }

  async function describe({ backendNodeId, generation: at }) {
    await send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} });
    const { frameTree } = await send("Page.getFrameTree");
    const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "cloudroom-select", grantUniveralAccess: false });
    await send("Runtime.evaluate", { expression: CONTEXT_SOURCE, contextId: executionContextId });
    const { object } = await send("DOM.resolveNode", { backendNodeId, executionContextId });
    const described = await send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function () { return globalThis.__cr8ElementContext.describe(this); }",
      returnByValue: true,
    });
    const element = described.result.value;
    const view = await send("Runtime.evaluate", { expression: "({ w: document.documentElement.clientWidth, h: innerHeight, sx: scrollX, sy: scrollY })", contextId: executionContextId, returnByValue: true });
    const { w, h, sx, sy } = view.result.value;
    const r = element.rect;
    const area = {
      x: Math.max(0, r.x - PAD),
      y: Math.max(0, r.y - PAD),
    };
    area.width = Math.min(w, r.x + r.width + PAD) - area.x;
    area.height = Math.min(h, r.y + r.height + PAD) - area.y;
    const measure = async () => (await send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function (area) { return { rect: this.getBoundingClientRect().toJSON(), masks: globalThis.__cr8ElementContext.sensitiveRects(this.ownerDocument, area, this) }; }",
      arguments: [{ value: area }],
      returnByValue: true,
    })).result.value;
    const before = await measure();
    const masks = before.masks;
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const closedHosts = [];
    const walk = (node) => {
      if (node.shadowRoots?.some((r) => r.shadowRootType === "closed")) closedHosts.push(node.backendNodeId);
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child);
      if (node.contentDocument) walk(node.contentDocument);
    };
    walk(root);
    for (const backend of closedHosts) {
      try {
        const { model } = await send("DOM.getBoxModel", { backendNodeId: backend });
        const q = model.border;
        const xs = [q[0], q[2], q[4], q[6]];
        const ys = [q[1], q[3], q[5], q[7]];
        const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), reason: "closed component" };
        if (box.x < area.x + area.width && box.x + box.width > area.x && box.y < area.y + area.height && box.y + box.height > area.y) masks.push(box);
      } catch {}
    }
    if (at !== generation) throw new Error("stale: page changed");
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: area.x + sx, y: area.y + sy, width: area.width, height: area.height, scale: 1 },
    });
    if (at !== generation) throw new Error("stale: page changed");
    const after = await measure();
    const moved = ["x", "y", "width", "height"].some((key) => Math.abs(after.rect[key] - before.rect[key]) > 0.5);
    if (moved) throw new Error("changed: the page moved during capture");
    for (const m of after.masks) if (!masks.some((n) => n.x === m.x && n.y === m.y && n.width === m.width && n.height === m.height)) masks.push(m);
    const image = nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
    const size = image.getSize();
    const scale = size.width / area.width;
    const bitmap = Buffer.from(image.toBitmap());
    const burned = [];
    for (const m of masks) {
      const x0 = Math.max(0, Math.floor((m.x - area.x) * scale));
      const y0 = Math.max(0, Math.floor((m.y - area.y) * scale));
      const x1 = Math.min(size.width, Math.ceil((m.x - area.x + m.width) * scale));
      const y1 = Math.min(size.height, Math.ceil((m.y - area.y + m.height) * scale));
      if (x1 <= x0 || y1 <= y0) continue;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * size.width + x) * 4;
          bitmap[i] = 17; bitmap[i + 1] = 17; bitmap[i + 2] = 17; bitmap[i + 3] = 255;
        }
      }
      burned.push({ ...m, x: m.x - area.x, y: m.y - area.y });
    }
    const png = nativeImage.createFromBitmap(bitmap, { width: size.width, height: size.height }).toPNG();
    await send("Overlay.highlightNode", { backendNodeId, highlightConfig: { showInfo: true, contentColor: { r: 191, g: 255, b: 0, a: 0.25 }, paddingColor: { r: 191, g: 255, b: 0, a: 0.35 }, borderColor: { r: 191, g: 255, b: 0, a: 1 } } });
    return { element, crop: { kind: "native", png, area, scale, masks: burned, target: { x: r.x - area.x, y: r.y - area.y, width: r.width, height: r.height } } };
  }

  function stop() {
    if (pending) pending.reject(new Error("cancelled"));
    pending = null;
    clearListener();
    if (owns && dbg.isAttached()) dbg.detach();
    owns = false;
  }

  return { start, describe, stop, get generation() { return generation; }, get listenerCount() { return dbg.listenerCount("message"); } };
}

async function evalMain(contents, expression) {
  return contents.executeJavaScript(expression, true);
}

async function clickAt(contents, x, y) {
  contents.sendInputEvent({ type: "mouseMove", x, y });
  await new Promise((r) => setTimeout(r, 60));
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

async function centerOf(contents, selector) {
  return evalMain(contents, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), rect: { x: r.left, y: r.top, width: r.width, height: r.height } }; })()`);
}

async function loaded(contents, url) {
  await contents.loadURL(url);
  await new Promise((r) => setTimeout(r, 200));
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))]);
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  const results = {};
  const win = new BrowserWindow({ width: 1280, height: 860, show: true });
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 860 });
  const contents = view.webContents;
  const selector = createSelector(contents);
  try {
    await loaded(contents, FIXTURE);
    await evalMain(contents, "window.scrollTo(0, 120)");
    await new Promise((r) => setTimeout(r, 100));

    const target = await centerOf(contents, "#start-trial");
    const session = await selector.start();
    await new Promise((r) => setTimeout(r, 150));
    await clickAt(contents, target.x, target.y);
    const picked = await withTimeout(session.picked, 3000, "inspectNodeRequested");
    const counters = await evalMain(contents, "({ clicks: window.__clicks, pointerdowns: window.__pointerdowns })");
    results.clickSuppressed = counters.clicks === 0 && counters.pointerdowns === 0;
    results.counters = counters;
    const { element, crop } = await selector.describe(picked);
    results.element = element;
    results.cropArea = crop.area;
    results.cropScale = crop.scale;
    results.rectMatches = Math.abs(element.rect.x - target.rect.x) < 1 && Math.abs(element.rect.y - target.rect.y) < 1 && Math.abs(element.rect.width - target.rect.width) < 1;
    writeFileSync(join(OUT, "desktop-crop-button.png"), crop.png);
    await new Promise((r) => setTimeout(r, 300));
    const [screen] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1280, height: 860 } });
    if (screen) writeFileSync(join(OUT, "desktop-native-highlight.png"), screen.thumbnail.crop({ x: 0, y: 0, width: 1280, height: 860 }).toPNG());
    results.highlightCaptured = Boolean(screen);
    selector.stop();

    const loginTarget = await evalMain(contents, "(() => { const f = document.querySelector('form.login'); f.scrollIntoView({ block: 'center' }); const r = f.getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) }; })()");
    await new Promise((r) => setTimeout(r, 100));
    const loginSession = await selector.start();
    await new Promise((r) => setTimeout(r, 150));
    await clickAt(contents, loginTarget.x, loginTarget.y);
    const loginPicked = await withTimeout(loginSession.picked, 3000, "login pick");
    const login = await selector.describe(loginPicked);
    results.loginElement = { tag: login.element.tag, name: login.element.name, text: login.element.text };
    results.loginMasks = login.crop.masks.map((m) => m.reason);
    results.loginSubmits = await evalMain(contents, "window.__submits");
    writeFileSync(join(OUT, "desktop-crop-login-redacted.png"), login.crop.png);
    selector.stop();

    const staleSession = await selector.start();
    contents.loadURL(FIXTURE.replace("/pricing", "/about"));
    try {
      await withTimeout(staleSession.picked, 3000, "stale");
      results.staleRejected = false;
    } catch (error) {
      results.staleRejected = /stale/.test(error.message);
      results.staleReason = error.message;
    }
    selector.stop();
    await new Promise((r) => setTimeout(r, 400));

    contents.debugger.attach("1.3");
    try {
      await selector.start();
      results.leaseConflictRefused = false;
    } catch (error) {
      results.leaseConflictRefused = /busy/.test(error.message);
    }
    selector.stop();
    results.agentLeaseSurvivesStop = contents.debugger.isAttached();
    contents.debugger.detach();

    await loaded(contents, FIXTURE);
    const baseline = selector.listenerCount;
    await selector.start();
    selector.stop();
    results.listenersCleaned = selector.listenerCount === baseline;

    const extras = await evalMain(contents, "(() => { const e = document.querySelector('.extras'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + 2), y: Math.round(r.top + r.height / 2) }; })()");
    await new Promise((r) => setTimeout(r, 150));
    const extrasSession = await selector.start();
    await new Promise((r) => setTimeout(r, 150));
    await clickAt(contents, extras.x, extras.y);
    const extrasPicked = await withTimeout(extrasSession.picked, 3000, "extras pick");
    const extrasResult = await selector.describe(extrasPicked);
    selector.stop();
    writeFileSync(join(OUT, "desktop-crop-extras-redacted.png"), extrasResult.crop.png);
    const reasons = extrasResult.crop.masks.map((m) => m.reason);
    results.extrasElement = { tag: extrasResult.element.tag, name: extrasResult.element.name, text: extrasResult.element.text };
    results.extrasMaskReasons = [...new Set(reasons)];
    results.extrasTextClean = !/Nightingale|4242|4111|AbCdEfGh12IjKl|billing@|dana@/.test(JSON.stringify(results.extrasElement));
    results.extrasMasksComplete = ["marked private", "secret-like text", "closed component", "embedded content"].every((reason) => reasons.includes(reason));
    results.ok = results.clickSuppressed && results.rectMatches && results.staleRejected && results.leaseConflictRefused && results.agentLeaseSurvivesStop && results.listenersCleaned && results.extrasTextClean && results.extrasMasksComplete && results.loginMasks.includes("password") && results.loginSubmits === 0;
  } catch (error) {
    results.error = String(error && error.stack || error);
    results.ok = false;
  }
  writeFileSync(join(OUT, "desktop-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  app.exit(results.ok ? 0 : 1);
});
