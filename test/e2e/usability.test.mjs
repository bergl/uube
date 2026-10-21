import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addApartment, openApp, openCard, photoFiles } from "./helpers.mjs";

const AXE = readFileSync(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

async function withApp(options, fn) {
  const app = await openApp(options);
  try {
    await fn(app);
    assert.deepEqual(app.errors, [], "the page logged errors");
  } finally {
    await app.close();
  }
}

test("guests can be entered by hand without an API key", () =>
  withApp({}, async ({ page }) => {
    assert.equal(await page.locator(".checklist li").count(), 2, "setup asks only for an apartment (plus the optional look)");
    await addApartment(page, { apiKey: "" });
    await page.click('.tab[data-view="stays"]');
    assert.equal(await page.locator(".onboarding").count(), 0, "no setup card once an apartment exists");
    await page.click(".fab-wrap");
    await page.click('[data-action="add-guest"]');
    const card = openCard(page);
    assert.match(await card.locator(".hint-box").innerText(), /Add this guest's name/);

    // Errors appear only for fields that were visited.
    await card.locator('[data-field="surname"]').focus();
    await card.locator('[data-field="givenNames"]').focus();
    await card.locator('[data-msg="surname"] .msg.error').waitFor();
    assert.equal(await card.locator('[data-field="surname"]').getAttribute("aria-invalid"), "true");
    assert.equal(await card.locator('[data-msg="documentNumber"] .msg').count(), 0);

    await card.locator('[data-field="surname"]').fill("Nováková");
    await card.locator('[data-field="givenNames"]').fill("Jana");
    await card.locator('[data-field="birthDate"]').fill("1990-02-01");
    await card.locator('[data-field="documentNumber"]').fill("SK1234567");
    await card.locator('[data-field="address"]').fill("Hlavná 1, Bratislava");
    await card.locator('[data-action="pick-country"]').click();
    await page.fill('[data-sheet-field="query"]', "slova");
    await page.locator('[data-action="choose-country"][data-code="SVK"]').click();
    assert.match(await card.locator('[data-action="pick-country"]').innerText(), /Slovakia \(SVK\)/);
    await card.locator('[data-action="review-guest"]').click();
    assert.match(await page.locator('[data-status="guest-summary"]').innerText(), /Ready: 1 of 1/);
  }));

test("reading photos asks for the key first, and the tray can be edited", () =>
  withApp({}, async ({ page }) => {
    await addApartment(page, { apiKey: "" });
    await page.click(".fab-wrap");
    await page.click('[data-action="pick-photos"]');
    await page.locator(".sheet-apikey").waitFor();
    await page.fill('[data-sheet-field="key"]', "sk-ant-test");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-action="save-key"]')]);
    await chooser.setFiles(photoFiles(3));
    assert.equal(await page.locator(".tray-item").count(), 3);
    await page.locator('[data-action="tray-remove"]').first().click();
    assert.equal(await page.locator(".tray-item").count(), 2);
    assert.match(await page.locator('[data-action="tray-read"]').innerText(), /Read 2 photos/);

    // A photo copied in WhatsApp can be pasted.
    await page.evaluate(() => {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      const data = new DataTransfer();
      data.items.add(new File([blob], "pasted.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    assert.equal(await page.locator(".tray-item").count(), 3);
    await page.click('[data-action="tray-cancel"]');
    assert.equal(await page.locator(".tray").count(), 0);
  }));

test("reading can be cancelled", () =>
  withApp({ delayMs: 4000 }, async ({ page }) => {
    await addApartment(page);
    await page.click(".fab-wrap");
    await page.setInputFiles("#photo-input", photoFiles(1));
    await page.click('[data-action="tray-read"]');
    await page.locator(".scanner").waitFor();
    await page.waitForFunction(() => /Waiting for Claude… \d+ s/.test(document.getElementById("progress-text")?.textContent || ""));
    await page.click('[data-action="cancel-reading"]');
    await page.locator(".toast", { hasText: "Reading cancelled" }).waitFor();
    assert.equal(await page.locator(".guest").count(), 0);
    assert.equal(await page.locator(".add-guests").count(), 1);
  }));

test("undo, empty drafts, back button and language menu", () =>
  withApp({}, async ({ page }) => {
    await addApartment(page);
    await page.click('.tab[data-view="stays"]');
    await page.click(".fab-wrap");
    await page.goBack();
    await page.waitForURL(/#\/$/);
    assert.equal(await page.locator(".stay-card").count(), 0, "an untouched new stay isn't kept");

    await page.click(".fab-wrap");
    await page.click('[data-action="add-guest"]');
    await openCard(page).locator('[data-field="surname"]').fill("Smith");
    await openCard(page).locator('[data-action="remove-guest"]').click();
    assert.equal(await page.locator(".guest").count(), 0);
    await page.click('[data-action="toast-action"]');
    assert.equal(await page.locator(".guest").count(), 1, "undo brings the guest back");

    await page.click('[data-action="delete-stay"]');
    await page.waitForURL(/#\/$/);
    assert.equal(await page.locator(".stay-card").count(), 0);
    await page.click('[data-action="toast-action"]');
    await page.waitForURL(/#\/stay\//);
    await page.goBack();
    await page.locator(".stay-card").first().waitFor();

    await page.click('[data-action="open-lang"]');
    await page.click('.sheet [data-lang="cs"]');
    assert.match(await page.locator(".tab").first().innerText(), /Pobyty/);
  }));

test("no serious accessibility problems in any theme", () =>
  withApp({}, async ({ page }) => {
    await addApartment(page);
    await page.click(".fab-wrap");
    await page.click('[data-action="add-guest"]');
    await openCard(page).locator('[data-field="surname"]').fill("Smith");
    const stayHash = new URL(page.url()).hash;
    const problems = [];
    for (const [theme, colorScheme] of [["prague", "light"], ["night", "light"], ["vltava", "light"], ["petrin", "light"], ["classic", "light"], ["classic", "dark"]]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.evaluate((th) => {
        const s = JSON.parse(localStorage.getItem("ubyport-helper-v1"));
        s.settings.theme = th;
        localStorage.setItem("ubyport-helper-v1", JSON.stringify(s));
      }, theme);
      for (const hash of ["#/", stayHash, "preview", "#/settings", "#/help"]) {
        if (hash === "preview") {
          await page.click('[data-action="preview-file"]');
          await page.locator(".preview-card").first().waitFor();
        } else {
          await page.goto(new URL(hash, page.url()).href);
          await page.reload();
        }
        if (hash === stayHash) await page.locator(".guest-row").first().click();
        await page.addScriptTag({ content: AXE });
        const found = await page.evaluate(async () => {
          const result = await axe.run(document, { resultTypes: ["violations"] });
          return result.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        });
        problems.push(...found.map((f) => `${theme}/${colorScheme} ${hash.slice(0, 8)} ${f}`));
      }
    }
    assert.deepEqual(problems, []);
  }));

test("header text never overlaps the skyline or the header buttons", () =>
  withApp({}, async ({ page }) => {
    await addApartment(page);
    await page.click(".fab-wrap");
    await page.click('[data-action="add-guest"]');
    const stayHash = new URL(page.url()).hash;
    const problems = [];
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const lang of ["ru", "cs", "en"]) {
        await page.evaluate((l) => {
          const s = JSON.parse(localStorage.getItem("ubyport-helper-v1"));
          s.settings.lang = l;
          localStorage.setItem("ubyport-helper-v1", JSON.stringify(s));
        }, lang);
        for (const hash of ["#/", stayHash, "#/settings", "#/help"]) {
          await page.goto(new URL(hash, page.url()).href);
          await page.reload();
          const result = await page.evaluate(() => {
            const text = document.getElementById("hero-text").getBoundingClientRect();
            const scene = document.querySelector(".hero > .scene").getBoundingClientRect();
            const tools = document.querySelector(".hero-tools").getBoundingClientRect();
            // Measure the rendered lines of text, not the boxes of the headings that contain them.
            const lines = [];
            const walker = document.createTreeWalker(document.getElementById("hero-text"), NodeFilter.SHOW_TEXT);
            for (let node; (node = walker.nextNode()); ) {
              const range = document.createRange();
              range.selectNodeContents(node);
              lines.push(...[...range.getClientRects()].filter((r) => r.width > 0));
            }
            return {
              belowText: Math.round(scene.top - text.bottom),
              underTools: lines.some((r) => r.right > tools.left + 1 && r.top < tools.bottom - 1 && r.bottom > tools.top + 1),
            };
          });
          if (result.belowText < -6) problems.push(`${width}px ${lang} ${hash.slice(0, 8)}: text runs ${-result.belowText}px into the skyline`);
          if (result.underTools) problems.push(`${width}px ${lang} ${hash.slice(0, 8)}: text runs under the header buttons`);
        }
      }
    }
    assert.deepEqual(problems, []);
  }));

test("API errors are explained in plain words and can be closed", () =>
  withApp({
    failWith: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use." }, request_id: "req_011" } },
  }, async ({ page }) => {
    await addApartment(page);
    await page.click(".fab-wrap");
    await page.setInputFiles("#photo-input", photoFiles(1));
    await page.click('[data-action="tray-read"]');
    const toast = page.locator(".toast.error");
    await toast.waitFor();
    const text = await toast.locator(".toast-text").innerText();
    assert.match(text, /isn't linked to a workspace/);
    assert.doesNotMatch(text, /invalid_request_error|\{/, "no raw JSON in the message");
    assert.equal(await toast.locator(".toast-detail code").isVisible(), false, "technical details stay folded");
    await toast.locator(".toast-detail summary").click();
    assert.match(await toast.locator(".toast-detail code").innerText(), /400 · invalid_request_error · This API key is not scoped/);
    await toast.locator(".toast-close").click();
    assert.equal(await page.locator(".toast").count(), 0);
  }));

test("the web-form copy list stays open while copying, and Help shows how to add the app to the Home Screen", () =>
  withApp({}, async ({ page }) => {
    await addApartment(page);
    await page.click('.tab[data-view="stays"]');
    await page.click(".fab-wrap");
    await page.click('[data-action="add-guest"]');
    await openCard(page).locator('[data-field="surname"]').fill("Smith");
    await page.locator("#sec-report details summary").click();
    const row = page.locator(".copy-row", { hasText: "Příjmení" });
    await row.waitFor();
    const layout = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".copy-row")].find((r) => r.textContent.includes("Příjmení"));
      return { open: document.querySelector("#sec-report details")?.open, tag: row?.tagName, height: row?.getBoundingClientRect().height };
    });
    assert.ok(layout.tag === "BUTTON" && layout.height > 40 && layout.height < 80, `copy row: ${JSON.stringify(layout)}`);
    // Headless browsers differ in clipboard support, so record what the app copies.
    await page.evaluate(() => {
      window.copied = [];
      navigator.clipboard.writeText = async (text) => void window.copied.push(text);
    });
    await row.click();
    await page.locator(".toast", { hasText: "Copied" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copied), ["Smith"]);
    assert.equal(await page.locator("#sec-report details[open]").count(), 1, "copying doesn't close the list");
    assert.match(await page.locator(".copy-row.copied").innerText(), /Smith/);

    // Tapping right after typing copies the new value, even before the list catches up.
    await openCard(page).locator('[data-field="surname"]').fill("Smithson");
    await row.click();
    await page.waitForFunction(() => window.copied.length === 2);
    assert.equal(await page.evaluate(() => window.copied[1]), "Smithson");

    await page.goto(new URL("#/help", page.url()).href);
    const guide = page.locator("#home-screen");
    assert.equal(await guide.locator(".a2hs-slide svg").count(), 4, "every step has a picture");
    assert.match(await guide.innerText(), /Share[\s\S]*More[\s\S]*Add to Home Screen[\s\S]*separate data/);
  }));
