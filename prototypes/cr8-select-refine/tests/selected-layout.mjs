import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, webkit } = await import(process.env.CR8_PLAYWRIGHT ?? "playwright");
const ROOM = process.env.CR8_ROOM ?? "http://localhost:4302";
const SHARE = process.env.CR8_SHARE ?? "http://localhost:4301";
const OUT = process.env.CR8_SELECTED_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "out", "selected");
const results = [];
mkdirSync(OUT, { recursive: true });

function check(engine, name, ok, detail) {
  results.push({ engine, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${engine}] ${name} ${JSON.stringify(detail ?? "")}`);
}

async function open(browser, viewport, phone) {
  await fetch(`${ROOM}/api/reset`, { method: "POST" });
  const context = await browser.newContext({ viewport, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${ROOM}/${phone ? "?tab=preview" : ""}`);
  await page.waitForFunction(() => !document.getElementById("select-toggle").disabled);
  const inner = page.frames().find((frame) => frame.url().startsWith(SHARE) && !frame.url().includes("/.well-known/"));
  return { context, page, inner };
}

async function select(page, inner, phone, selector = "#start-trial", prepare = true) {
  if (prepare) await inner.locator(selector).scrollIntoViewIfNeeded();
  await page.click("#select-toggle");
  await page.waitForFunction(() => document.getElementById("select-toggle").getAttribute("aria-pressed") === "true");
  await page.frames().find((frame) => frame.url().includes("/.well-known/")).waitForSelector("body.selecting");
  const frameBox = await (await inner.frameElement()).boundingBox();
  const rect = await inner.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  });
  if (phone) await page.touchscreen.tap(frameBox.x + rect.x, frameBox.y + rect.y);
  else await page.mouse.click(frameBox.x + rect.x, frameBox.y + rect.y);
  await page.waitForSelector(".request-text");
  await page.waitForFunction(() => document.querySelector(".crop-caption")?.textContent.length > 0);
}

async function visibleControls(page, selector, includeFocusRing = false) {
  return page.locator(selector).evaluateAll((nodes, includeFocusRing) => nodes.map((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const ring = includeFocusRing ? (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0) : 0;
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      const b = p.getBoundingClientRect();
      if (s.overflowX !== "visible") { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (s.overflowY !== "visible") { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return { text: el.textContent, fits: r.left - ring >= left - 1 && r.right + ring <= right + 1 && r.top - ring >= top - 1 && r.bottom + ring <= bottom + 1, width: r.width, height: r.height, ring, top: r.top, bottom: r.bottom, clipTop: top, clipBottom: bottom };
  }), includeFocusRing);
}

const engines = [
  ["chromium-phone", chromium, { width: 390, height: 664 }, true],
  ["chromium-narrow", chromium, { width: 320, height: 568 }, true],
  ["chromium-short", chromium, { width: 390, height: 440 }, true],
  ["webkit-phone", webkit, { width: 390, height: 664 }, true],
  ["chromium-desktop", chromium, { width: 1440, height: 900 }, false],
];

for (const [engine, launcher, viewport, phone] of engines.filter(([name]) => !process.env.CR8_SELECTED_ENGINES || process.env.CR8_SELECTED_ENGINES.split(",").includes(name))) {
  const browser = await launcher.launch();
  const { context, page, inner } = await open(browser, viewport, phone);
  try {
    await select(page, inner, phone);
    if (phone) {
      await page.locator(".crop-tools").scrollIntoViewIfNeeded();
      const tools = await visibleControls(page, ".crop-tools button");
      check(engine, "every crop tool is fully reachable without horizontal scrolling", tools.every((b) => b.fits && b.width >= 44 && b.height >= 44), tools);
      const source = page.locator('.chips li[data-key="source"]');
      await source.scrollIntoViewIfNeeded();
      const anchor = await source.evaluate((el) => {
        const text = el.querySelector("span");
        return { label: text.textContent, visible: text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1, falselyVerified: el.classList.contains("ok") };
      });
      check(engine, "source file and line remain readable without implying verification", anchor.label.includes("src/components/PricingCard.tsx:34") && anchor.visible && !anchor.falselyVerified, anchor);
      await page.locator(".request-text").click();
      await page.locator(".request-text").fill("Keep the selected source anchor and fix this spacing.");
      const requestVisible = await visibleControls(page, ".request-text", true);
      const actions = await visibleControls(page, '.review-actions button');
      check(engine, "request and all drawer actions fit after focusing the request", requestVisible.every((x) => x.fits) && actions.every((x) => x.fits), { requestVisible, actions });
      await page.screenshot({ path: join(OUT, `${engine}.png`) });
    } else {
      const dock = await page.evaluate(() => {
        const p = document.getElementById("preview-body").getBoundingClientRect();
        const r = document.querySelector(".review").getBoundingClientRect();
        return { previewBottom: p.bottom, reviewTop: r.top, previewLeft: p.left, reviewLeft: r.left };
      });
      check(engine, "selected desktop review remains docked under preview", Math.abs(dock.previewBottom - dock.reviewTop) < 1 && Math.abs(dock.previewLeft - dock.reviewLeft) < 1, dock);
      await page.screenshot({ path: join(OUT, `${engine}.png`) });
    }
    await page.click('[data-action="cancel"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    const picker = page.frames().find((frame) => frame.url().includes("/.well-known/"));
    await picker.waitForFunction(() => !document.body.classList.contains("selecting"));
    await picker.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(engine, "Cancel keeps composer draft and uploads nothing", (await page.inputValue("#draft")) === "Also tighten the footer spacing when you get a chance." && (await (await fetch(`${ROOM}/api/log`)).json()).uploads.length === 0);
    await inner.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "1600px";
      document.body.append(spacer);
      document.querySelector("#start-trial").scrollIntoView({ block: "center" });
    });
    const before = await inner.evaluate(() => scrollY);
    await select(page, inner, phone, "#start-trial", false);
    const during = await inner.evaluate(() => scrollY);
    await page.click('[data-action="cancel"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    await page.waitForTimeout(80);
    const after = await inner.evaluate(() => scrollY);
    check(engine, "closing selection returns to the original preview reading position", Math.abs(before - after) <= 1, { before, during, after });
    await select(page, inner, phone);
    await page.fill(".request-text", "Refine this selected element; keep its source anchor.");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => !document.querySelector(".review"));
    await page.waitForTimeout(80);
    const shell = page.frames().find((frame) => frame.url().includes("/.well-known/"));
    const ended = await shell.evaluate(() => !document.body.classList.contains("selecting"));
    const sentLog = await (await fetch(`${ROOM}/api/log`)).json();
    check(engine, "Queue ends the picker and preserves the verified source anchor", ended && /Source: src\/components\/PricingCard.tsx:34 \(found in project\)/.test(sentLog.queued[0]?.text ?? ""), { ended, verifyCalls: sentLog.verifyCalls });
    if (!phone) {
      await inner.locator("#scroller").scrollIntoViewIfNeeded();
      const original = await inner.locator("#scroller").evaluate((el) => el.scrollTop);
      await page.click("#select-toggle");
      await shell.waitForSelector("body.selecting");
      const box = await inner.locator("#scroller").boundingBox();
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.wheel(0, -80);
      await page.waitForTimeout(100);
      const moved = await inner.locator("#scroller").evaluate((el) => el.scrollTop);
      await page.click("#select-cancel");
      await page.waitForTimeout(80);
      const returned = await inner.locator("#scroller").evaluate((el) => el.scrollTop);
      check(engine, "Cancel restores a panel scrolled by the picker", moved !== original && Math.abs(returned - original) <= 1, { original, moved, returned });
    }
    if (phone) await page.click('[data-tab="chat"]');
    for (let i = 0; i < 18; i++) {
      await fetch(`${ROOM}/api/threads/thr_pricing/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_acme", text: `Reading anchor ${i}: ${"Keep my place in this conversation. ".repeat(8)}`, attachments: [], mode: "queue-if-active" }) });
    }
    await page.click("#finish-turn");
    await page.waitForFunction(() => [...document.querySelectorAll("#timeline .msg")].some((el) => el.textContent.startsWith("Reading anchor 17:")));
    await page.locator("#timeline").evaluate((el) => el.scrollTop = 140);
    const reading = await page.locator("#timeline").evaluate((el) => el.scrollTop);
    const timelineSize = await page.locator("#timeline").evaluate((el) => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, shell: document.getElementById("app").clientHeight, viewport: innerHeight }));
    check(engine, "long conversation has a usable reading scroll container", reading > 0 && timelineSize.height < viewport.height, timelineSize);
    if (phone) {
      await page.click('[data-tab="preview"]');
      await page.click('[data-tab="chat"]');
      const returned = await page.locator("#timeline").evaluate((el) => el.scrollTop);
      check(engine, "Chat to Preview to Chat keeps the conversation reading position", reading > 0 && Math.abs(returned - reading) <= 1, { reading, returned });
    }
    await page.fill("#draft", "New follow-up while reading earlier messages");
    await page.click("#composer-send");
    await page.waitForFunction(() => [...document.querySelectorAll("#timeline .msg")].some((el) => el.textContent === "New follow-up while reading earlier messages"));
    const updated = await page.locator("#timeline").evaluate((el) => el.scrollTop);
    check(engine, "sending a follow-up preserves the earlier conversation reading position", reading > 0 && Math.abs(updated - reading) <= 1, { reading, updated });
  } catch (error) {
    check(engine, "selected workflow completed", false, String(error.stack || error));
  } finally {
    await context.close();
    await browser.close();
  }
}
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failures = results.filter((result) => !result.ok);
console.log(`${results.length - failures.length}/${results.length} passed`);
process.exitCode = failures.length ? 1 : 0;
