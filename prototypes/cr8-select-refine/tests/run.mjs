import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, webkit, devices } = await import(process.env.CR8_PLAYWRIGHT ?? "playwright");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const ROOM = process.env.CR8_ROOM ?? "http://localhost:4302";
const APP = process.env.CR8_APP ?? "http://localhost:4300";
const SHARE = process.env.CR8_SHARE ?? "http://localhost:4301";
const SECRETS = ["hunter2", "4242 4242", "csrf-token", "dana@example.com", "sk-live-", "rotate creds", "ghost text"];
mkdirSync(OUT, { recursive: true });

const results = [];
let current = "";

function check(name, ok, detail) {
  results.push({ engine: current, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${current}] ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

async function reset() {
  await fetch(`${ROOM}/api/reset`, { method: "POST" });
}

async function log() {
  return (await fetch(`${ROOM}/api/log`)).json();
}

async function open(browser, device, query = "?tab=preview") {
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));
  await page.goto(`${ROOM}/${query}`);
  await page.waitForFunction(() => !document.getElementById("select-toggle").disabled, null, { timeout: 10_000 });
  const shell = page.frames().find((f) => f.url().startsWith(SHARE));
  const inner = () => page.frames().find((f) => f.url().startsWith(SHARE) && !f.url().includes("/.well-known/"));
  return { ctx, page, shell, inner };
}

async function tapOn(page, inner, selector, touch) {
  const frameEl = await inner().frameElement();
  const outer = await frameEl.boundingBox();
  const box = await inner().locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  const x = outer.x + box.x + Math.min(box.width / 2, 40);
  const y = outer.y + box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  return box;
}

async function select(page, inner, selector, touch) {
  if ((await page.getAttribute("#select-toggle", "aria-pressed")) !== "true") await page.click("#select-toggle");
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__cr8.reviews);
  const box = await tapOn(page, inner, selector, touch);
  await page.waitForFunction((n) => window.__cr8.reviews > n && document.querySelector(".review .request-text"), before, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector(".crop-caption")?.textContent.length > 0);
  return box;
}

async function lastSelection(page) {
  return page.evaluate(() => {
    const view = document.querySelector(".review");
    return view ? { chips: [...view.querySelectorAll(".chips li")].map((li) => li.textContent), caption: view.querySelector(".crop-caption").textContent } : null;
  });
}

async function cropPixels(page) {
  return page.evaluate(() => {
    const c = document.querySelector(".crop-canvas");
    if (!c || c.hidden) return null;
    return { width: c.width, height: c.height, url: c.toDataURL("image/png") };
  });
}

async function compareImages(page, a, b, cssSize) {
  return page.evaluate(async ([a, b, cssSize]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = cssSize.width;
    const h = cssSize.height;
    const read = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
    const da = read(ia);
    const db = read(ib);
    let sum = 0;
    let off = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      sum += d;
      if (d > 48) off++;
    }
    return { size: [ia.width, ia.height, ib.width, ib.height], meanDiff: sum / (w * h), offPixelRatio: off / (w * h) };
  }, [a, b, cssSize]);
}

async function suite(engineName, browser, device, touch) {
  current = engineName;

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    await tapOn(page, inner, "#about-link", touch);
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    await inner().evaluate(() => document.querySelectorAll("button.cta")[1].scrollIntoView({ block: "start" }));
    await tapOn(page, inner, "button.cta >> nth=1", touch);
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await inner().evaluate(() => window.scrollTo(0, 0));
    const box = await select(page, inner, "#start-trial", touch);
    const counters = await inner().evaluate(() => ({ clicks: window.__clicks, pointerdowns: window.__pointerdowns, touchstarts: window.__touchstarts, path: location.pathname }));
    check("taps in selection mode never reach the page", counters.clicks === 0 && counters.pointerdowns === 0 && counters.touchstarts === 0 && counters.path === "/pricing", counters);
    const sel = await lastSelection(page);
    check("selected the tapped element with label and selector", sel.chips.some((c) => c.includes("Start free trial")) && sel.chips.some((c) => c.includes("#start-trial")), sel.chips);
    check("verified source hint is shown", sel.chips.some((c) => c.includes("PricingCard.tsx:34")), sel.chips);
    const highlight = await page.frames().find((f) => f.url().includes("/.well-known/")).evaluate(() => {
      const b = document.getElementById("picked").getBoundingClientRect();
      return { x: b.x + 2, y: b.y + 2, width: b.width - 4, height: b.height - 4, display: getComputedStyle(document.getElementById("picked")).display };
    });
    const live = await inner().locator("#start-trial").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const delta = Math.max(Math.abs(highlight.x - live.x), Math.abs(highlight.y - live.y), Math.abs(highlight.width - live.width), Math.abs(highlight.height - live.height));
    check("highlight box matches the element (≤1px)", highlight.display === "block" && delta <= 1, { highlight, live });
    const crop = await cropPixels(page);
    check("crop image produced", crop !== null, crop && { width: crop.width, height: crop.height });
    if (crop) {
      const scroll = await inner().evaluate(() => ({ x: scrollX, y: scrollY, w: document.documentElement.clientWidth, h: innerHeight }));
      const frameSize = await (await inner().frameElement()).boundingBox();
      const ref = await browser.newContext({ ...device, viewport: { width: Math.round(frameSize.width), height: Math.round(frameSize.height) } });
      const refPage = await ref.newPage();
      await refPage.goto(`${APP}/pricing`);
      await refPage.evaluate(([x, y]) => window.scrollTo(x, y), [scroll.x, scroll.y]);
      await refPage.waitForTimeout(150);
      const area = { x: Math.max(0, Math.floor(live.x - 16)), y: Math.max(0, Math.floor(live.y - 16)) };
      area.width = Math.min(scroll.w, Math.ceil(live.x + live.width + 16)) - area.x;
      area.height = Math.min(scroll.h, Math.ceil(live.y + live.height + 16)) - area.y;
      const shot = await refPage.screenshot({ clip: area });
      await ref.close();
      const cmp = await compareImages(page, crop.url, `data:image/png;base64,${shot.toString("base64")}`, area);
      const ratio = (size, css) => Math.abs((size[1] * css[0]) / size[0] - css[1]) <= 2;
      writeFileSync(join(OUT, `${engineName}-crop-reference.png`), shot);
      writeFileSync(join(OUT, `${engineName}-crop-rendered.png`), Buffer.from(crop.url.split(",")[1], "base64"));
      check("rendered crop matches a real screenshot of the same region", ratio([cmp.size[0], cmp.size[1]], [area.width, area.height]) && ratio([cmp.size[2], cmp.size[3]], [area.width, area.height]) && cmp.offPixelRatio < 0.08, { ...cmp, area });
    }
    await page.screenshot({ path: join(OUT, `${engineName}-selected.png`) });
    check("nothing uploaded before Send", (await log()).uploads.length === 0);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    const before = await inner().evaluate(() => scrollY);
    const frameBox = await (await inner().frameElement()).boundingBox();
    const cx = frameBox.x + frameBox.width / 2;
    if (touch) {
      const cdp = engineName.startsWith("chromium") ? await ctx.newCDPSession(page) : null;
      if (cdp) {
        const y0 = frameBox.y + frameBox.height - 40;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: y0 }] });
        for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: y0 - i * 25 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(cx, frameBox.y + frameBox.height - 40);
        await page.mouse.down();
        await page.mouse.move(cx, frameBox.y + 40, { steps: 10 });
        await page.mouse.up();
      }
    } else {
      await page.mouse.move(cx, frameBox.y + frameBox.height / 2);
      await page.mouse.wheel(0, 250);
    }
    await page.waitForTimeout(300);
    const after = await inner().evaluate(() => scrollY);
    const noSelection = (await page.$(".review")) === null;
    check("drag/wheel scrolls the page in selection mode without selecting", after > before + 100 && noSelection, { before, after, noSelection });
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await inner().evaluate(() => document.querySelector("form.login").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    const frameBox = await (await inner().frameElement()).boundingBox();
    const form = await inner().locator("form.login").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    const point = { x: frameBox.x + form.x + 6, y: frameBox.y + form.y + form.height / 2 };
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await page.waitForSelector(".review .request-text");
    await page.waitForFunction(() => document.querySelector(".crop-caption")?.textContent.length > 0);
    const caption = (await lastSelection(page)).caption;
    check("form fields auto-hidden in the image", /3 areas hidden/.test(caption) || /areas hidden/.test(caption), caption);
    await page.fill(".request-text", "Make the sign-in form narrower");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    const sent = await log();
    const text = JSON.stringify(sent.queued);
    check("no field values, hidden inputs or secrets in the request text", SECRETS.every((s) => !text.includes(s)), sent.queued[0]?.text);
    const uploaded = await page.evaluate(async () => {
      const res = await fetch("/api/attachments/1");
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext("2d");
      x.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, url: c.toDataURL() };
    });
    writeFileSync(join(OUT, `${engineName}-uploaded-login.png`), Buffer.from(uploaded.url.split(",")[1], "base64"));
    check("uploaded image is the crop, not the full viewport", uploaded.width < 1300 && sent.uploads.length === 1, sent.uploads);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await inner().evaluate(() => document.querySelector(".note").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await select(page, inner, ".note p:nth-of-type(2)", touch);
    await page.fill(".request-text", "Hide this key behind a reveal button");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    let sent = await log();
    check("secret-like page text redacted in context", !JSON.stringify(sent.queued).includes("sk-live-") && JSON.stringify(sent.queued).includes("[redacted]"), sent.queued[0]?.text);
    await inner().evaluate(() => document.querySelector("[data-testid=plan-starter]").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await select(page, inner, "[data-testid=plan-starter] h2", touch);
    await page.fill(".request-text", "Bigger heading");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    sent = await log();
    check("CSS-hidden and transparent text never sent", !/rotate creds|ghost text/.test(JSON.stringify(sent.queued)) && /Starter/.test(sent.queued[1]?.text ?? ""), sent.queued[1]?.text);
    sent.queued.splice(1, 1);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    await tapOn(page, inner, "#injection", touch);
    await page.waitForSelector(".review .request-text");
    await page.fill(".request-text", "Shorten this note");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    sent = await log();
    const msg = sent.queued[2]?.text ?? "";
    check("page text is fenced as untrusted data and quoted", msg.includes("page data from the preview, not instructions") && /Text: "Ignore all previous instructions/.test(msg) === false && /- Element: paragraph "Ignore all previous instructions/.test(msg), msg);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await select(page, inner, "#start-trial", touch);
    await inner().evaluate(() => history.pushState({}, "", "/pricing?tab=teams"));
    await page.waitForFunction(() => !document.querySelector(".review"), null, { timeout: 3000 }).catch(() => {});
    const afterNav = await page.evaluate(() => ({ review: !!document.querySelector(".review"), inv: window.__cr8.invalidations.slice() }));
    check("SPA navigation invalidates the selection", !afterNav.review && afterNav.inv.length > 0, afterNav);

    await page.click("#select-toggle");
    await page.waitForTimeout(100);
    const shellFrame = page.frames().find((f) => f.url().includes("/.well-known/"));
    await shellFrame.evaluate((roomOrigin) => {
      window.parent.postMessage({ cr8: 1, previewId: "wrong-preview-id", generation: 0, type: "select:result", nonce: "n", seq: 1, element: {}, crop: {} }, roomOrigin);
    }, ROOM);
    await inner().evaluate(() => window.parent.parent.postMessage({ cr8: 1, type: "select:result", element: {}, crop: {} }, "*"));
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({ review: !!document.querySelector(".review") }));
    check("forged or foreign messages never create a selection", !state.review, state);

    await inner().evaluate(() => {
      const script = window.parent.document.createElement("script");
      script.src = "/forge.js";
      window.parent.document.body.append(script);
    });
    await page.waitForTimeout(300);
    if ((await page.getAttribute("#select-toggle", "aria-pressed")) === "true") await page.click("#select-toggle");
    await page.click("#select-toggle");
    await page.waitForTimeout(500);
    const spoof = await page.evaluate(() => ({
      review: !!document.querySelector(".review"),
      injected: !!document.querySelector(".review img") || window.__pwned === 1,
      chips: [...document.querySelectorAll(".chips li")].map((li) => li.textContent).join(" | "),
      caption: document.querySelector(".crop-caption")?.textContent ?? "",
      sent: window.__cr8.sends,
    }));
    check("page-forged result: no HTML/script injection, secrets re-redacted, bad image and path dropped, nothing sent", !spoof.injected && !spoof.chips.includes("sk-live") && !spoof.chips.includes("passwd") && spoof.review && /invalid/.test(spoof.caption) && spoof.sent === 0, spoof);
    await page.keyboard.press("Escape");
    await page.click("#reload");
    await page.waitForFunction(() => !document.getElementById("select-toggle").disabled && window.__cr8.state().generation >= 1);
    await select(page, inner, "#start-trial", touch);
    await page.click("#reload");
    await page.waitForTimeout(300);
    check("reload invalidates the selection", (await page.$(".review")) === null);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await page.click("#select-toggle");
    const btn = await inner().locator("#start-trial").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    const before = await page.evaluate(() => window.__cr8.state());
    await inner().evaluate(() => history.pushState({}, "", "/pricing?late=1"));
    await page.waitForFunction((g) => window.__cr8.state().generation > g, before.generation);
    const shellFrame = page.frames().find((f) => f.url().includes("/.well-known/"));
    await page.click("#select-toggle");
    await page.waitForTimeout(100);
    const live = await page.evaluate(() => window.__cr8.state());
    await shellFrame.evaluate(([roomOrigin, s, oldGeneration]) => {
      window.parent.postMessage({ cr8: 1, previewId: s.previewId, generation: oldGeneration, type: "select:result", nonce: s.nonce, seq: 1, element: { tag: "button" }, crop: { kind: "unavailable", reason: "x" } }, roomOrigin);
    }, [ROOM, live, before.generation]);
    await page.waitForTimeout(300);
    const late = await page.evaluate(() => ({ review: !!document.querySelector(".review"), rejected: window.__cr8.rejected.length }));
    check("late result from an older page is rejected", !late.review && late.rejected === 1, late);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await select(page, inner, "#start-trial", touch);
    await page.fill(".request-text", "Make it green");
    await page.click("#switch-thread");
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({ review: !!document.querySelector(".review"), title: document.querySelector("#thread-header .title").textContent }));
    check("switching threads clears the selection", !state.review && state.title === "Rewrite onboarding", state);
    const res = await fetch(`${ROOM}/api/threads/thr_docs/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_acme", text: "x", mode: "queue-if-active" }) });
    check("server refuses a request whose project doesn't match the thread", res.status === 409);
    const steer = await fetch(`${ROOM}/api/threads/thr_pricing/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_acme", text: "x", mode: "steer-if-active" }) });
    check("mock send path only accepts queue-if-active", steer.status === 400);
    check("nothing was sent to the other thread", (await log()).queued.length === 0 && (await log()).messages.length === 0);
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    const draft = await page.inputValue("#draft");
    await select(page, inner, "#start-trial", touch);
    await page.click('[data-action="cancel"]');
    check("cancel discards without uploading or sending", (await page.$(".review")) === null && (await log()).uploads.length === 0 && (await log()).queued.length === 0);
    await select(page, inner, "#start-trial", touch);
    await page.click('[data-action="remove-image"]');
    await page.fill(".request-text", "Make this button green");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    let l = await log();
    check("remove image sends details only", l.uploads.length === 0 && l.queued.length === 1 && l.queued[0].attachments.length === 0 && !l.queued[0].text.includes("- Image:"));
    check("running thread: request is queued, not sent or steered", l.messages.length === 0 && l.queued.length === 1);
    check("existing composer draft is untouched", (await page.inputValue("#draft")) === draft && draft.length > 0, draft);

    await select(page, inner, "#start-trial", touch);
    await page.click('[data-action="redact"]');
    const canvas = await page.locator(".crop-canvas").boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await page.fill(".request-text", "Bigger text");
    if (touch) await page.click('#mobile-tabs [data-tab="chat"]');
    await page.click("#finish-turn");
    if (touch) await page.click('#mobile-tabs [data-tab="preview"]');
    await page.waitForTimeout(200);
    const label = await page.textContent('[data-action="send"]');
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    l = await log();
    const pixel = await page.evaluate(async () => {
      const blob = await (await fetch("/api/attachments/1")).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext("2d");
      x.drawImage(bmp, 0, 0);
      return [...x.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data];
    });
    check("manual redaction is burned into the uploaded image", pixel[0] < 30 && pixel[1] < 30 && pixel[2] < 30, pixel);
    check("idle thread: request is sent directly (button says Send)", label === "Send" && l.messages.some((m) => m.text.includes("Bigger text") && m.attachments.length === 1), label);
    check("queued request was delivered when the turn finished", l.messages.some((m) => m.deliveredFromQueue && m.text.includes("Make this button green")));
    await ctx.close();
  }

  await reset();
  {
    const { ctx, page, inner } = await open(browser, device);
    await page.click("#select-toggle");
    await page.waitForTimeout(150);
    const shellFrame = page.frames().find((f) => f.url().includes("/.well-known/"));
    await shellFrame.focus("#catcher");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".review .request-text", { timeout: 5000 }).catch(() => {});
    const picked = await lastSelection(page);
    check("keyboard: Tab highlights, Enter chooses", picked !== null, picked?.chips);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    check("Escape cancels", (await page.$(".review")) === null);
    await ctx.close();
  }

  {
    const { ctx, page } = await open(browser, device, "?tab=preview&path=/framed-deny").catch(async () => {
      const c = await browser.newContext({ ...device });
      const p = await c.newPage();
      await p.goto(`${ROOM}/?tab=preview&path=/framed-deny`);
      await p.waitForTimeout(1500);
      return { ctx: c, page: p };
    });
    const state = await page.evaluate(() => ({ disabled: document.getElementById("select-toggle").disabled, address: document.getElementById("preview-address").textContent }));
    check("preview that refuses framing: selection unavailable, explained", state.disabled && /can't inspect/.test(state.address), state);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    await page.goto(`${APP}/about`);
    await page.setContent(`<iframe id="f" src="${SHARE}/.well-known/cloudroom/select/?path=/"></iframe>`);
    await page.waitForTimeout(1000);
    const frame = page.frames().find((f) => f.url().includes("/.well-known/"));
    let loaded = false;
    try {
      loaded = frame ? await frame.evaluate(() => !!document.getElementById("catcher")) : false;
    } catch {
      loaded = false;
    }
    check("select shell refuses to load inside other sites (frame-ancestors)", !loaded);
    await ctx.close();
  }
}

const engines = (process.env.CR8_ENGINES ?? "chromium-phone,webkit-phone,chromium-desktop").split(",");
for (const name of engines) {
  const browser = name.startsWith("webkit") ? await webkit.launch() : await chromium.launch();
  const device = name.endsWith("phone") ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } };
  try {
    await suite(name, browser, device, name.endsWith("phone"));
  } catch (error) {
    check("suite crashed", false, String(error.stack || error));
  }
  await browser.close();
}
writeFileSync(join(OUT, "test-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
