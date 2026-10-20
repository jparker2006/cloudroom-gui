(() => {
  const APP_ORIGIN = document.querySelector('meta[name="cloudroom-app-origin"]').content;
  const SHELL_PATH = "/.well-known/cloudroom/select";
  const DRAG_SLOP = 8;
  const CANDIDATES = "a[href],button,input,select,textarea,[role],[tabindex],h1,h2,h3,h4,h5,h6,img,p,li,label,article,section,nav,header,footer";
  const frame = document.getElementById("frame");
  const catcher = document.getElementById("catcher");
  const hoverBox = document.getElementById("hover");
  const pickedBox = document.getElementById("picked");
  const tag = document.getElementById("tag");
  const context = globalThis.__cr8ElementContext;
  const render = globalThis.__cr8Render;

  let previewId = null;
  let generation = 0;
  let lastHref = null;
  let session = null;

  function post(message) {
    window.parent.postMessage({ cr8: 1, previewId, generation, ...message }, APP_ORIGIN);
  }

  function initialPath() {
    const raw = new URLSearchParams(location.search).get("path") || "/";
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin || url.pathname.startsWith(SHELL_PATH)) return "/";
      return url.pathname + url.search + url.hash;
    } catch {
      return "/";
    }
  }

  function frameWindow() {
    try {
      const win = frame.contentWindow;
      void win.document.body;
      return win;
    } catch {
      return null;
    }
  }

  function currentPath(win) {
    return win.location.pathname + win.location.search;
  }

  function invalidate(reason) {
    generation++;
    const win = frameWindow();
    lastHref = win ? win.location.href : null;
    const wasSelecting = session !== null;
    endSession();
    post({ type: "navigated", reason, path: win ? currentPath(win) : null, wasSelecting });
  }

  frame.addEventListener("load", () => {
    const win = frameWindow();
    if (!win) {
      post({ type: "unavailable", reason: "The preview can't be inspected. It may block framing or redirect to another site." });
      return;
    }
    invalidate("load");
    win.addEventListener("scroll", reposition, { passive: true });
    win.addEventListener("resize", reposition);
    win.addEventListener("pagehide", () => invalidate("unload"));
  });

  setInterval(() => {
    const win = frameWindow();
    if (win && lastHref !== null && win.location.href !== lastHref) invalidate("url-change");
  }, 200);

  function frameRect() {
    return frame.getBoundingClientRect();
  }

  function placeBox(box, rect) {
    if (!rect) {
      box.style.display = "none";
      return;
    }
    const outer = frameRect();
    box.style.display = "block";
    box.style.left = `${outer.left + rect.left - 2}px`;
    box.style.top = `${outer.top + rect.top - 2}px`;
    box.style.width = `${rect.width + 4}px`;
    box.style.height = `${rect.height + 4}px`;
  }

  function placeTag(rect, text) {
    if (!rect) {
      tag.style.display = "none";
      return;
    }
    tag.textContent = text;
    tag.style.display = "block";
    const top = rect.top > 26 ? rect.top - 24 : rect.bottom + 6;
    tag.style.left = `${Math.max(4, rect.left)}px`;
    tag.style.top = `${top}px`;
  }

  function label(el) {
    const info = context.describe(el);
    return info.name ? `${info.tag} · ${info.name}` : info.tag;
  }

  function reposition() {
    if (!session) return;
    placeBox(hoverBox, session.hover ? session.hover.getBoundingClientRect() : null);
    const picked = session.picked ? session.picked.getBoundingClientRect() : null;
    placeBox(pickedBox, picked);
    placeTag(picked, session.picked ? label(session.picked) : "");
  }

  function deepest(doc, x, y) {
    let el = doc.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    if (el && (el === doc.documentElement || el === doc.body)) return null;
    return el;
  }

  function pointToFrame(event) {
    const outer = frameRect();
    return { x: event.clientX - outer.left, y: event.clientY - outer.top };
  }

  function endSession() {
    session = null;
    document.body.classList.remove("selecting");
    placeBox(hoverBox, null);
    placeBox(pickedBox, null);
    placeTag(null);
  }

  async function choose(el) {
    if (!session) return;
    const nonce = session.nonce;
    const startedGeneration = generation;
    session.picked = el;
    session.hover = null;
    session.seq++;
    const seq = session.seq;
    reposition();
    const win = frameWindow();
    const info = context.describe(el);
    const area = render.cropArea(win, info.rect);
    const masks = context.sensitiveRects(win.document, area);
    let crop;
    try {
      crop = await render.renderCrop(win, info.rect, masks);
    } catch (error) {
      crop = { kind: "unavailable", reason: error.message === "canvas-tainted" ? "This browser blocks rendering the page to an image." : error.message === "page-too-large" ? "The page is too large to render on this device." : "The element could not be rendered." };
    }
    if (!session || session.nonce !== nonce || session.seq !== seq || generation !== startedGeneration) return;
    post({ type: "select:result", nonce, seq, element: info, crop });
  }

  function candidates(win) {
    const vw = win.document.documentElement.clientWidth;
    const vh = win.innerHeight;
    return [...win.document.querySelectorAll(CANDIDATES)].filter((el) => {
      if (el.matches("input[type=hidden]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    });
  }

  catcher.addEventListener("pointerdown", (event) => {
    if (!session) return;
    event.preventDefault();
    catcher.setPointerCapture(event.pointerId);
    session.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false };
  });

  catcher.addEventListener("pointermove", (event) => {
    if (!session) return;
    const win = frameWindow();
    if (!win) return;
    const pointer = session.pointer;
    if (pointer && pointer.id === event.pointerId) {
      if (!pointer.dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > DRAG_SLOP) pointer.dragging = true;
      if (pointer.dragging) {
        win.scrollBy(pointer.lastX - event.clientX, pointer.lastY - event.clientY);
        pointer.lastX = event.clientX;
        pointer.lastY = event.clientY;
      }
      return;
    }
    if (event.pointerType !== "mouse") return;
    const point = pointToFrame(event);
    const el = deepest(win.document, point.x, point.y);
    session.hover = el && el !== session.picked ? el : null;
    reposition();
  });

  catcher.addEventListener("pointerup", (event) => {
    if (!session || !session.pointer || session.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const { dragging } = session.pointer;
    session.pointer = null;
    if (dragging) return;
    const win = frameWindow();
    if (!win) return;
    const point = pointToFrame(event);
    const el = deepest(win.document, point.x, point.y);
    if (el) void choose(el);
  });

  catcher.addEventListener("pointercancel", () => {
    if (session) session.pointer = null;
  });

  catcher.addEventListener("click", (event) => event.preventDefault());
  catcher.addEventListener("contextmenu", (event) => event.preventDefault());

  catcher.addEventListener("wheel", (event) => {
    const win = frameWindow();
    if (!session || !win) return;
    event.preventDefault();
    win.scrollBy(event.deltaX, event.deltaY);
  }, { passive: false });

  catcher.addEventListener("keydown", (event) => {
    if (!session) return;
    const win = frameWindow();
    if (!win) return;
    if (event.key === "Escape") {
      event.preventDefault();
      const nonce = session.nonce;
      endSession();
      post({ type: "select:ended", nonce, reason: "cancelled" });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const list = candidates(win);
      if (list.length === 0) return;
      const current = session.hover ?? session.picked;
      const index = list.indexOf(current);
      const next = list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length];
      session.hover = next;
      next.scrollIntoView({ block: "nearest" });
      reposition();
      catcher.setAttribute("aria-label", `Highlighted: ${label(next)}. Enter to choose.`);
      return;
    }
    if (event.key === "Enter" && session.hover) {
      event.preventDefault();
      void choose(session.hover);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== APP_ORIGIN) return;
    const data = event.data;
    if (!data || data.cr8 !== 1 || typeof data.type !== "string") return;
    if (data.type === "hello") {
      if (previewId !== null) return;
      if (typeof data.previewId !== "string" || !/^[\w-]{8,64}$/.test(data.previewId)) return;
      previewId = data.previewId;
      frame.src = initialPath();
      return;
    }
    if (data.previewId !== previewId) return;
    if (data.type === "select:start" && typeof data.nonce === "string") {
      if (!frameWindow()) {
        post({ type: "select:ended", nonce: data.nonce, reason: "unavailable" });
        return;
      }
      session = { nonce: data.nonce, seq: 0, picked: null, hover: null, pointer: null };
      document.body.classList.add("selecting");
      catcher.focus({ preventScroll: true });
      return;
    }
    if (!session || data.nonce !== session.nonce) return;
    if (data.type === "select:cancel") {
      endSession();
      return;
    }
    if (data.type === "select:reveal" && session.picked && Number.isFinite(data.bottomInset)) {
      const win = frameWindow();
      const rect = session.picked.getBoundingClientRect();
      const visible = Math.max(80, win.innerHeight - Math.max(0, data.bottomInset));
      if (rect.top < 8 || rect.bottom > visible - 8) win.scrollBy(0, rect.top - Math.max(8, (visible - rect.height) / 2));
      reposition();
      return;
    }
    if (data.type === "select:step" && session.picked) {
      const el = session.picked;
      const next = data.direction === "parent" ? el.parentElement : el.firstElementChild;
      if (next && next !== el.ownerDocument.body && next !== el.ownerDocument.documentElement) void choose(next);
    }
  });

  window.addEventListener("resize", reposition);
})();
