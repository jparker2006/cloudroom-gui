const { chromium, devices } = await import(process.env.CR8_PLAYWRIGHT ?? "playwright");
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.env.CR8_DESIGN_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "designs");
const ROOM = process.env.CR8_ROOM ?? "http://localhost:4302";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shoot(name, device, query, { pick = "#start-trial", request = "Make this full width on mobile and use our brand green.", selectOnly = false } = {}) {
  if (process.env.CR8_DESIGNS && !process.env.CR8_DESIGNS.split(",").includes(name)) return;
  await fetch(`${ROOM}/api/reset`, { method: "POST" });
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  await page.goto(`${ROOM}/${query}`);
  await page.waitForFunction(() => !document.getElementById("select-toggle").disabled);
  const inner = page.frames().find((f) => f.url().includes(":4301") && !f.url().includes("/.well-known/"));
  await inner.locator(pick).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.click("#select-toggle");
  await page.waitForTimeout(200);
  if (selectOnly) {
    const frameBox = await (await inner.frameElement()).boundingBox();
    const r = await inner.locator(pick).evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.move(frameBox.x + r.x, frameBox.y + r.y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    await ctx.close();
    return;
  }
  const frameBox = await (await inner.frameElement()).boundingBox();
  const r = await inner.locator(pick).evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
  if (device.hasTouch) await page.touchscreen.tap(frameBox.x + r.x, frameBox.y + r.y);
  else await page.mouse.click(frameBox.x + r.x, frameBox.y + r.y);
  await page.waitForSelector(".review .request-text");
  await page.waitForFunction(() => document.querySelector(".crop-caption")?.textContent.length > 0);
  await page.fill(".request-text", request);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await ctx.close();
}

const phone = devices["iPhone 13"];
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
await shoot("mobile-0-selecting", phone, "?tab=preview", { selectOnly: true });
await shoot("mobile-A-half-sheet", phone, "?tab=preview&layout=a");
await shoot("mobile-B-full-review", phone, "?tab=preview&layout=b");
await shoot("desktop-0-selecting", desktop, "", { selectOnly: true });
await shoot("desktop-A-docked-in-preview", desktop, "?layout=a");
await shoot("desktop-B-card-above-composer", desktop, "?layout=b");
await shoot("mobile-A-sensitive-form", phone, "?tab=preview&layout=a", { pick: "#password", request: "Add a show/hide toggle to this field." });
await browser.close();
console.log(`designs written to ${OUT}`);
