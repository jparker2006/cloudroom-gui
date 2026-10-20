(() => {
  const MAX_ELEMENTS = 5000;
  const MAX_CROP = 1200;
  const PAD = 16;
  const SKIP = new Set(["script", "noscript", "template", "iframe", "object", "embed", "video", "audio"]);

  function cropArea(win, rect) {
    const vw = win.document.documentElement.clientWidth;
    const vh = win.innerHeight;
    const x = Math.max(0, Math.floor(rect.x - PAD));
    const y = Math.max(0, Math.floor(rect.y - PAD));
    const right = Math.min(vw, Math.ceil(rect.x + rect.width + PAD), x + MAX_CROP);
    const bottom = Math.min(vh, Math.ceil(rect.y + rect.height + PAD), y + MAX_CROP);
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  function fontStack(value) {
    const cleaned = value.replace(/-webkit-standard|-webkit-body/g, "system-ui").trim();
    if (/\b(?:sans-serif|serif|monospace|cursive|fantasy)\b/.test(cleaned) && !/^system-ui$/.test(cleaned)) return cleaned;
    return `${cleaned || "system-ui"}, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  }

  function inlineStyles(win, source, target) {
    const style = win.getComputedStyle(source);
    let css = "";
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      if (name.startsWith("transition") || name.startsWith("animation")) continue;
      let value = style.getPropertyValue(name);
      if (name === "font-family") value = fontStack(value);
      css += `${name}:${value};`;
    }
    target.setAttribute("style", css);
  }

  async function imageDataUrl(img) {
    try {
      if (!img.complete || !img.naturalWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  async function snapshotDocument(win) {
    const doc = win.document;
    const sources = [doc.documentElement, ...doc.documentElement.querySelectorAll("*")];
    if (sources.length > MAX_ELEMENTS) throw new Error("page-too-large");
    const clone = doc.documentElement.cloneNode(true);
    const targets = [clone, ...clone.querySelectorAll("*")];
    const removals = [];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const target = targets[i];
      if (SKIP.has(source.localName) || source.localName === "link" || source.localName === "style" || source.localName === "meta" || source.localName === "title") {
        removals.push(target);
        continue;
      }
      if (source.localName === "head") continue;
      for (const attr of [...target.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === "value" || attr.name === "placeholder" || attr.name === "srcset") target.removeAttribute(attr.name);
      }
      inlineStyles(win, source, target);
      if (source.localName === "textarea") target.textContent = "";
      if (source.localName === "option") target.textContent = "";
      if (source.localName === "img") {
        const data = await imageDataUrl(source);
        if (data) target.setAttribute("src", data);
        else target.removeAttribute("src");
      }
      if (source.localName === "canvas") {
        removals.push(target);
      }
    }
    for (const node of removals) node.remove();
    return clone;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("render-failed"));
      img.src = url;
    });
  }

  async function renderCrop(win, rect, masks) {
    const doc = win.document;
    const area = cropArea(win, rect);
    const scale = Math.min(2, Math.max(1, win.devicePixelRatio || 1));
    const clone = await snapshotDocument(win);
    const width = Math.max(doc.documentElement.scrollWidth, doc.documentElement.clientWidth);
    const height = Math.max(doc.documentElement.scrollHeight, win.innerHeight);
    const serialized = new XMLSerializer().serializeToString(clone);
    const outW = Math.round(area.width * scale);
    const outH = Math.round(area.height * scale);
    const offsetX = win.scrollX + area.x;
    const offsetY = win.scrollY + area.y;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}">` +
      `<foreignObject x="0" y="0" width="${outW}" height="${outH}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;transform-origin:0 0;transform:scale(${scale}) translate(${-offsetX}px,${-offsetY}px)">` +
      `${serialized}</div></foreignObject></svg>`;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = win.getComputedStyle(doc.body).backgroundColor || "#fff";
    if (ctx.fillStyle === "rgba(0, 0, 0, 0)") ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    const burned = [];
    for (const mask of masks) {
      const x = Math.max(0, mask.x - area.x);
      const y = Math.max(0, mask.y - area.y);
      const w = Math.min(area.width, mask.x - area.x + mask.width) - x;
      const h = Math.min(area.height, mask.y - area.y + mask.height) - y;
      if (w <= 0 || h <= 0) continue;
      ctx.fillRect(x * scale, y * scale, w * scale, h * scale);
      burned.push({ x, y, width: w, height: h, reason: mask.reason });
    }
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      throw new Error("canvas-tainted");
    }
    return {
      kind: "rendered",
      dataUrl,
      area,
      scale,
      target: { x: rect.x - area.x, y: rect.y - area.y, width: rect.width, height: rect.height },
      masks: burned,
    };
  }

  globalThis.__cr8Render = { renderCrop, cropArea };
})();
