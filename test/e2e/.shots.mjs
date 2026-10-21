// Not a test: captures release screenshots into the folder given as argv[2].
import { addApartment, openApp, openCard, photoFiles } from "./helpers.mjs";
const out = process.argv[2];
const app = await openApp();
const { page } = app;
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });
const small = async () => page.evaluate(() => [...document.querySelectorAll("button, a, select, input:not([type=file]), summary")]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44) && getComputedStyle(e).visibility !== "hidden" && !e.closest("p, td, li.inline") && !e.matches("input[type=checkbox], input[type=radio]"); })
  .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}[${e.dataset.action || ""}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
const report = [];

await shot("r2-1-first-run");
report.push(["first run", await small()]);
await addApartment(page);
await shot("r2-2-settings", { fullPage: true });
report.push(["settings", await small()]);
await page.click('.tab[data-view="stays"]');
await page.click(".fab-wrap");
await page.setInputFiles("#photo-input", photoFiles(3));
await page.locator('[data-action="tray-rotate"]').nth(1).click();
await page.waitForTimeout(400);
await shot("r2-3-tray");
report.push(["stay+tray", await small()]);
await page.click('[data-action="tray-read"]');
await page.locator(".guest").nth(1).waitFor();
await page.waitForTimeout(700);
await openCard(page).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -120));
await shot("r2-4-guest-open");
report.push(["guest open", await small()]);
await page.click('[data-action="export"]');
await page.waitForTimeout(900);
await shot("r2-5-todo");
await openCard(page).locator('[data-action="pick-country"]').click();
await page.fill('[data-sheet-field="query"]', "ger");
await page.waitForTimeout(300);
await shot("r2-6-country");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1280, height: 860 });
await page.waitForTimeout(500);
await shot("r2-7-desktop");
console.log(JSON.stringify(report, null, 1));
console.log(app.errors.length ? app.errors : "no page errors");
await app.close();
