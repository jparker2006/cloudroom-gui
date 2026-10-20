(() => {
  const MAX_NAME = 120;
  const MAX_TEXT = 200;
  const SECRET_PATTERNS = [
    /\b(?:sk|pk|rk)[-_](?:live|test)[-_][A-Za-z0-9]{8,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g,
    /\b[A-Za-z0-9_+/=-]{32,}\b/g,
    /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    /\b(?:\d[ -]?){13,19}\b/g,
  ];
  const FIELD_TAGS = new Set(["input", "textarea", "select"]);
  const SENSITIVE_SELECTOR = [
    "input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=color]):not([type=image])",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable=false])",
    "[data-private]",
    "[data-cloudroom-redact]",
  ].join(",");
  const IMPLICIT_ROLES = {
    a: (el) => (el.hasAttribute("href") ? "link" : null),
    button: () => "button",
    h1: () => "heading", h2: () => "heading", h3: () => "heading",
    h4: () => "heading", h5: () => "heading", h6: () => "heading",
    img: (el) => (el.getAttribute("alt") === "" ? "presentation" : "img"),
    nav: () => "navigation",
    main: () => "main",
    header: () => "banner",
    footer: () => "contentinfo",
    form: () => "form",
    article: () => "article",
    section: () => "region",
    ul: () => "list", ol: () => "list", li: () => "listitem",
    select: () => "combobox",
    textarea: () => "textbox",
    p: () => "paragraph",
    input: (el) => {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    },
  };

  function redactText(value) {
    let out = value;
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
    return out;
  }

  function clean(value, max) {
    const collapsed = String(value ?? "")
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const redacted = redactText(collapsed);
    return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted;
  }

  function isField(el) {
    return FIELD_TAGS.has(el.localName) || el.isContentEditable;
  }

  const EXCLUDED_TEXT = "input,textarea,select,script,style,template,noscript,[hidden],[aria-hidden=true],[data-private],[data-cloudroom-redact],[contenteditable]:not([contenteditable=false])";

  function rendered(node) {
    if (node.checkVisibility) return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    return node.getClientRects().length > 0 && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function visibleText(el) {
    if (isField(el)) return "";
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, doc.defaultView.NodeFilter.SHOW_TEXT);
    let out = "";
    for (let node = walker.nextNode(); node && out.length < 2000; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(EXCLUDED_TEXT) || !rendered(parent)) continue;
      out += ` ${node.nodeValue}`;
    }
    return out;
  }

  function textOfIds(doc, ids) {
    return ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter(Boolean)
      .map((node) => visibleText(node))
      .join(" ");
  }

  function accessibleName(el) {
    const doc = el.ownerDocument;
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = textOfIds(doc, labelledBy);
      if (text.trim()) return text;
    }
    if (el.localName === "img") return el.getAttribute("alt") || el.getAttribute("title") || "";
    if (isField(el)) {
      if (el.id) {
        const label = doc.querySelector(`label[for="${doc.defaultView.CSS.escape(el.id)}"]`);
        if (label) return visibleText(label);
      }
      const wrapping = el.closest("label");
      if (wrapping) return visibleText(wrapping);
      return el.getAttribute("placeholder") || el.getAttribute("name") || "";
    }
    return el.getAttribute("title") || visibleText(el);
  }

  function role(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    return IMPLICIT_ROLES[el.localName]?.(el) ?? null;
  }

  function stableToken(value) {
    return value && value.length <= 48 && !/\d{3,}|^[a-f0-9-]{8,}$|^(?:css|sc|jsx|emotion|svelte)-|__[a-zA-Z0-9]{5,}$/i.test(value);
  }

  function unique(doc, selector) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function selectorFor(el) {
    const doc = el.ownerDocument;
    const esc = doc.defaultView.CSS.escape;
    if (el.id && stableToken(el.id) && unique(doc, `#${esc(el.id)}`)) return `#${esc(el.id)}`;
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && node !== doc.documentElement && depth < 6; depth++) {
      const testId = node.getAttribute("data-testid");
      if (node !== el && node.id && stableToken(node.id)) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      if (testId && stableToken(testId)) {
        parts.unshift(`${node.localName}[data-testid="${esc(testId)}"]`);
        if (unique(doc, parts.join(" > "))) break;
        node = node.parentElement;
        continue;
      }
      let part = node.localName;
      const classes = [...node.classList].filter(stableToken).slice(0, 2);
      if (classes.length) part += `.${classes.map(esc).join(".")}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.localName === node.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (unique(doc, parts.join(" > "))) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function sourceCandidate(el) {
    const tagged = el.closest("[data-inspector-relative-path]");
    if (tagged) {
      const file = tagged.getAttribute("data-inspector-relative-path") || "";
      const line = Number(tagged.getAttribute("data-inspector-line") || 0);
      if (/^[\w./-]{1,200}$/.test(file) && !file.includes("..")) {
        return { file, line: Number.isInteger(line) && line > 0 ? line : null, via: "data-inspector" };
      }
    }
    for (let node = el; node; node = node.parentElement) {
      const key = Object.keys(node).find((name) => name.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let fiber = node[key]; fiber; fiber = fiber.return) {
        const source = fiber._debugSource;
        if (source && typeof source.fileName === "string") {
          return { file: source.fileName.slice(-200), line: Number(source.lineNumber) || null, via: "react-debug-source" };
        }
      }
      break;
    }
    return null;
  }

  function safeHref(el) {
    const raw = el.getAttribute("href");
    if (!raw) return null;
    try {
      const url = new URL(raw, el.ownerDocument.baseURI);
      if (!/^https?:$/.test(url.protocol)) return url.protocol;
      return url.origin === el.ownerDocument.defaultView.location.origin ? url.pathname : url.origin;
    } catch {
      return null;
    }
  }

  function round(rect) {
    return {
      x: Math.round(rect.left ?? rect.x),
      y: Math.round(rect.top ?? rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function describe(el) {
    const win = el.ownerDocument.defaultView;
    const style = win.getComputedStyle(el);
    const name = clean(accessibleName(el), MAX_NAME);
    const text = clean(visibleText(el), MAX_TEXT);
    const attributes = {};
    if (el.localName === "input") attributes.type = (el.getAttribute("type") || "text").toLowerCase();
    const href = safeHref(el);
    if (href) attributes.href = href;
    if (el.hasAttribute("disabled")) attributes.disabled = true;
    for (const state of ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked"]) {
      const value = el.getAttribute(state);
      if (value === "true" || value === "false") attributes[state] = value;
    }
    return {
      tag: el.localName,
      role: role(el),
      name,
      text: text && text !== name ? text : "",
      selector: selectorFor(el),
      attributes,
      sensitiveField: isField(el),
      rect: round(el.getBoundingClientRect()),
      viewport: { width: el.ownerDocument.documentElement.clientWidth, height: win.innerHeight, dpr: win.devicePixelRatio || 1 },
      path: win.location.pathname,
      style: {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        padding: style.padding,
        borderRadius: style.borderRadius,
      },
      sourceCandidate: sourceCandidate(el),
    };
  }

  function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function sensitiveRects(doc, area) {
    const out = [];
    const add = (rect, reason) => {
      const r = round(rect);
      if (r.width > 0 && r.height > 0 && intersects(r, area)) out.push({ ...r, reason });
    };
    for (const el of doc.querySelectorAll(SENSITIVE_SELECTOR)) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const reason = type === "password" ? "password" : /^cc-/.test(el.getAttribute("autocomplete") || "") ? "payment field" : el.matches("[data-private],[data-cloudroom-redact]") ? "marked private" : "form value";
      add(el.getBoundingClientRect(), reason);
    }
    const walker = doc.createTreeWalker(doc.body, doc.defaultView.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue || "";
      if (value.length < 8) continue;
      for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
          const range = doc.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          for (const rect of range.getClientRects()) add(rect, "secret-like text");
        }
      }
    }
    return out;
  }

  globalThis.__cr8ElementContext = { describe, sensitiveRects, clean, redactText };
})();
