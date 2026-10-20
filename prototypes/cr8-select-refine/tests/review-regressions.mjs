import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium, webkit } = await import(process.env.CR8_PLAYWRIGHT ?? "playwright");
const ROOM = process.env.CR8_ROOM ?? "http://localhost:4302";
const SHARE = process.env.CR8_SHARE ?? "http://localhost:4301";
const OUT = process.env.CR8_REVIEW_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "out", "selected", "review");
const results = [];
mkdirSync(OUT, { recursive: true });
const log = async () => (await fetch(`${ROOM}/api/log`)).json();

async function open(browser, phone) {
  await fetch(`${ROOM}/api/reset`, { method: "POST" });
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 664 } : { width: 1440, height: 900 }, hasTouch: phone, isMobile: phone });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${ROOM}/?tab=preview`);
  await page.waitForFunction(() => !document.getElementById("select-toggle").disabled);
  const shell = page.frames().find((f) => f.url().includes("/.well-known/"));
  const inner = page.frames().find((f) => f.url().startsWith(SHARE) && !f.url().includes("/.well-known/"));
  return { context, page, shell, inner, phone };
}

async function select({ page, shell, inner, phone }, selector) {
  await inner.locator(selector).scrollIntoViewIfNeeded();
  if ((await page.getAttribute("#select-toggle", "aria-pressed")) !== "true") await page.click("#select-toggle");
  await shell.waitForSelector("body.selecting");
  await inner.locator(selector).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shell.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.evaluate(() => window.__cr8.reviews);
  const frame = await (await inner.frameElement()).boundingBox();
  const point = await inner.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  });
  if (phone) await page.touchscreen.tap(frame.x + point.x, frame.y + point.y);
  else await page.mouse.click(frame.x + point.x, frame.y + point.y);
  await page.waitForFunction((n) => window.__cr8.reviews > n && document.querySelector(".crop-caption")?.textContent.length > 0, before);
}

async function cancel({ page, shell }) {
  await page.click('[data-action="cancel"]');
  await page.waitForFunction(() => !document.querySelector(".review"));
  await shell.waitForFunction(() => !document.body.classList.contains("selecting"));
  await shell.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function check(engine, name, ok, detail) {
  results.push({ engine, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${engine}] ${name} ${JSON.stringify(detail ?? "")}`);
}

for (const [engine, launcher, phone] of [["chromium-phone", chromium, true], ["webkit-phone", webkit, true], ["chromium-desktop", chromium, false]]) {
  const browser = await launcher.launch();
  async function scenario(name, run) {
    const ctx = await open(browser, phone);
    try {
      const { ok, detail } = await run(ctx);
      check(engine, name, ok, detail);
    } catch (error) {
      check(engine, name, false, String(error.stack || error));
    } finally {
      await ctx.context.close();
    }
  }

  await scenario("Cancel during source verification cannot upload a replacement selection", async (ctx) => {
    const { page } = ctx;
    await select(ctx, "#start-trial");
    let started, release;
    const entered = new Promise((resolve) => started = resolve);
    const gate = new Promise((resolve) => release = resolve);
    await page.route("**/verify-source", async (route) => {
      started();
      await gate;
      await route.continue();
    });
    await page.fill(".request-text", "Change only the original selected button.");
    await page.click('[data-action="send"]');
    await entered;
    await cancel(ctx);
    await select(ctx, ".featured .cta");
    const done = page.waitForResponse((response) => response.url().endsWith("/verify-source"));
    release();
    await done;
    await page.waitForFunction(() => document.getElementById("toast").textContent.length > 0);
    const state = await log();
    const replacement = await page.locator('.chips li[data-key="element"]').textContent();
    return { ok: state.uploads.length === 0 && state.queued.length === 0 && state.messages.length === 0 && replacement.includes("Buy Pro"), detail: { uploads: state.uploads.length, queued: state.queued.length, messages: state.messages.length, replacement } };
  });

  await scenario("Cancel during image export prevents upload after the blob completes", async (ctx) => {
    const { page } = ctx;
    await select(ctx, "#start-trial");
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        window.__exportStarted = true;
        window.__finishExport = () => original.call(this, callback, ...args);
      };
    });
    await page.fill(".request-text", "Send this original crop only.");
    await page.click('[data-action="send"]');
    await page.waitForFunction(() => window.__exportStarted === true);
    await cancel(ctx);
    await select(ctx, ".featured .cta");
    await page.evaluate(() => window.__finishExport());
    await page.waitForFunction(() => document.getElementById("toast").textContent.length > 0);
    const state = await log();
    return { ok: state.uploads.length === 0 && state.queued.length === 0 && state.messages.length === 0, detail: { uploads: state.uploads.length, queued: state.queued.length, messages: state.messages.length } };
  });

  await scenario("A late send acknowledgment cannot clear a replacement review or its draft", async (ctx) => {
    const { page } = ctx;
    await select(ctx, "#start-trial");
    let submitted, release;
    const sent = new Promise((resolve) => submitted = resolve);
    const gate = new Promise((resolve) => release = resolve);
    await page.route("**/api/threads/thr_pricing/messages", async (route) => {
      const response = await route.fetch();
      submitted();
      await gate;
      await route.fulfill({ response });
    });
    await page.fill(".request-text", "Original authorized request.");
    await page.click('[data-action="send"]');
    await sent;
    await cancel(ctx);
    await select(ctx, ".featured .cta");
    await page.fill(".request-text", "Unsent replacement draft.");
    const response = page.waitForResponse((r) => r.url().endsWith("/messages"));
    release();
    await response;
    await page.waitForFunction(() => document.getElementById("toast").textContent.length > 0);
    const draft = await page.locator(".request-text").count() ? await page.inputValue(".request-text") : null;
    const state = await log();
    return { ok: draft === "Unsent replacement draft." && state.queued.length === 1 && state.queued[0].text.includes("Original authorized request.") && !state.queued[0].text.includes("Unsent replacement draft."), detail: { draft, queued: state.queued.length, uploads: state.uploads.length } };
  });

  for (const kind of ["private-host", "nested-redacted-host", "private-slot"]) {
    await scenario(`${kind}: composed private label never appears in the review or queued request`, async (ctx) => {
      const secret = `Confidential customer workspace ${kind}`;
      await ctx.inner.evaluate(({ kind, secret }) => {
        const host = document.createElement("privacy-sample");
        host.style.cssText = "display:block;padding:12px";
        const root = host.attachShadow({ mode: "open" });
        const button = document.createElement("button");
        button.id = "privacy-target";
        button.textContent = secret;
        button.style.cssText = "padding:12px;font-size:16px";
        if (kind === "private-slot") {
          root.innerHTML = "<slot data-private></slot>";
          host.append(button);
        } else {
          host.setAttribute(kind === "private-host" ? "data-private" : "data-cloudroom-redact", "");
          if (kind === "nested-redacted-host") {
            const nested = document.createElement("nested-sample");
            nested.style.display = "block";
            nested.attachShadow({ mode: "open" }).append(button);
            root.append(nested);
          } else root.append(button);
        }
        document.querySelector("main").prepend(host);
      }, { kind, secret });
      await select(ctx, "#privacy-target");
      const review = await ctx.page.locator(".chips").textContent();
      const pixel = await ctx.page.locator(".crop-canvas").evaluate((canvas) => [...canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
      await ctx.page.fill(".request-text", "Improve this control's spacing.");
      await ctx.page.click('[data-action="send"]');
      await ctx.page.waitForFunction(() => !document.querySelector(".review"));
      const state = await log();
      const text = JSON.stringify(state.queued);
      return { ok: !review.includes(secret) && !text.includes(secret) && text.includes("[private]") && pixel.slice(0, 3).every((channel) => channel === 17), detail: { review, pixel, text: state.queued[0]?.text } };
    });
  }

  await scenario("An unchanged explicit send still uploads its reviewed image and verified source", async (ctx) => {
    await select(ctx, "#start-trial");
    const expected = await ctx.page.locator(".crop-canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
    await ctx.page.fill(".request-text", "Keep this original reviewed source and image.");
    await ctx.page.click('[data-action="send"]');
    await ctx.page.waitForFunction(() => !document.querySelector(".review"));
    const state = await log();
    return { ok: state.uploads.length === 1 && state.queued.length === 1 && state.uploads[0].width === expected.width && state.uploads[0].height === expected.height && /PricingCard.tsx:34 \(found in project\)/.test(state.queued[0].text), detail: { expected, uploads: state.uploads, queued: state.queued.length } };
  });
  await browser.close();
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
