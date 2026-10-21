import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { addApartment, downloadText, openApp, openCard, photoFiles } from "./helpers.mjs";

let app;
before(async () => (app = await openApp()));
after(async () => {
  assert.deepEqual(app.errors, [], "the page logged errors");
  await app.close();
});

test("a stay goes from photos to a confirmed report", async () => {
  const { page } = app;
  await addApartment(page);
  await page.click(".fab-wrap");
  assert.match(page.url(), /#\/stay\/\w+$/);
  await page.click('[data-action="set-nights"][data-n="3"]');
  const arrival = await page.inputValue("#in-arrival");
  const departure = await page.inputValue("#in-departure");
  assert.equal((Date.parse(departure) - Date.parse(arrival)) / 86400000, 3);

  // Photos wait in a tray first: rotate one, then read.
  await page.setInputFiles("#photo-input", photoFiles(2));
  assert.equal(await page.locator(".tray-item").count(), 2);
  await page.locator('[data-action="tray-rotate"]').first().click();
  assert.match(await page.locator(".tray-item img").first().getAttribute("style"), /--rot:90deg/);
  await page.click('[data-action="tray-read"]');
  await page.locator(".guest").nth(1).waitFor();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].messages[0].content.filter((b) => b.type === "image").length, 2);

  // One guest open at a time; the misread passport number was fixed from the passport code.
  assert.equal(await openCard(page).count(), 1);
  assert.equal(await openCard(page).locator('[data-field="documentNumber"]').inputValue(), "C01X00T47");
  assert.equal(await page.locator(".guest-row .pill.ok", { hasText: "Passport code OK" }).count(), 2);
  assert.equal(await openCard(page).locator(".thumb").count(), 1, "the photo is shown next to the fields");

  // Trying to export early lists exactly what is missing.
  await page.click('[data-action="export"]');
  await page.locator(".todo.attempted").waitFor();
  assert.match(await page.locator(".todo").innerText(), /Hans Peter Müller — Missing: Home address abroad/);

  await openCard(page).locator('[data-field="address"]').fill("12 Baker Street, London");
  await openCard(page).locator('[data-action="review-guest"]').click();
  assert.match(await openCard(page).locator(".guest-name strong").innerText(), /Emily Smith/, "the next guest opens");
  await openCard(page).locator('[data-action="use-address"]').click();
  assert.equal(await openCard(page).locator('[data-field="address"]').inputValue(), "12 Baker Street, London");
  await openCard(page).locator('[data-action="review-guest"]').click();
  assert.equal(await openCard(page).count(), 0);
  assert.match(await page.locator('[data-status="guest-summary"]').innerText(), /Ready: 2 of 2/);

  // The file can be previewed before downloading, readable or raw.
  await page.click('[data-action="preview-file"]');
  const preview = page.locator(".sheet");
  assert.equal(await preview.locator(".preview-card").count(), 3, "header plus one card per guest");
  assert.match(await preview.locator(".preview-card").first().innerText(), /Hans Peter Müller[\s\S]*DEU · Germany[\s\S]*12 Baker Street, London/);
  await preview.locator('[data-action="preview-mode"][data-mode="raw"]').click();
  assert.match(await preview.locator(".unl-raw").innerText(), /^A\|2\|123456789\|[\s\S]*\nU\|.*\|Müller\|Hans Peter\|/);
  const fromPreview = await downloadText(page, () => preview.locator('[data-action="export"]').click(), "windows-1250");
  assert.match(fromPreview.name, /\.unl$/);
  assert.equal(await page.locator(".sheet").count(), 0, "downloading closes the preview");

  const first = await downloadText(page, () => page.click('[data-action="export"]'), "windows-1250");
  assert.match(first.name, /^123456789_\d{12}\.unl$/);
  const lines = first.text.split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^A\|2\|123456789\|\|Jana Nováková\|/);
  assert.match(lines[1], /^U\|\d\d\.\d\d\.\d{4}\|\d\d\.\d\d\.\d{4}\|Müller\|Hans Peter\|\|14\.03\.1985\|\|\|DEU\|12 Baker Street, London\|C01X00T47\|\|10\|\|$/);

  // Finished sections fold away and open again on a tap.
  assert.equal(await page.locator("#sec-guests.collapsed").count(), 1, "the guests section folds once everyone is reviewed");
  assert.match(await page.locator('#sec-guests .section-summary').innerText(), /2 guests · all reviewed/);
  await page.click('#sec-guests [data-action="toggle-section"]');
  assert.equal(await page.locator("#sec-guests .section-toggle").getAttribute("aria-expanded"), "true");

  // Changing reportable data after the export is noticed and needs a fresh review.
  await page.locator(".guest-row").nth(1).click();
  await openCard(page).locator('[data-field="address"]').fill("1 Abbey Road, London");
  await page.locator(".banner.warn").waitFor();
  await openCard(page).locator('[data-action="review-guest"]').click();
  assert.match(await page.locator('[data-action="export"]').innerText(), /Download updated file/);
  const second = await downloadText(page, () => page.click('[data-action="export"]'), "windows-1250");
  assert.match(second.text, /1 Abbey Road, London/);

  // Reporting needs an explicit confirmation of the receipt.
  await page.click('[data-action="open-report-sheet"]');
  assert.ok(await page.isDisabled('[data-action="confirm-report"]'));
  await page.check('[data-sheet-field="checked"]');
  await page.fill('[data-sheet-field="ref"]', "R-2041");
  await page.click('[data-action="confirm-report"]');
  await page.waitForURL(/#\/$/);
  await page.locator(".history summary").click();
  assert.match(await page.locator(".history .stay-card").innerText(), /Reported/);
});

test("editing a reported stay reopens it and re-checks the passport code", async () => {
  const { page } = app;
  await page.locator(".history .stay-card").click();
  assert.equal(await page.locator(".section.collapsed").count(), 2, "a finished stay opens with both sections folded");
  await page.click('#sec-guests [data-action="toggle-section"]');
  await page.locator(".guest-row").first().click();
  await openCard(page).locator('[data-field="documentNumber"]').fill("C01X00T48");
  await page.locator(".guest-row .pill.warn", { hasText: "Differs from passport code" }).waitFor();
  assert.match(await openCard(page).locator('[data-msg="documentNumber"]').innerText(), /Differs from the passport code \(C01X00T47\)/);
  await page.locator(".banner.bad").waitFor();
  await page.goBack();
  await page.waitForURL(/#\/$/);
  assert.match(await page.locator(".stack .stay-card").first().innerText(), /Changed after reporting/);
});

test("backup, restore check, restore and undo", async () => {
  const { page } = app;
  await page.click('.tab[data-view="settings"]');
  const backup = await downloadText(page, () => page.click('[data-action="backup"]'));
  const data = JSON.parse(backup.text);
  assert.equal(data.app, "ubyport-helper");
  assert.equal(data.settings.apiKey, "", "the API key is never in a backup");
  assert.equal(data.stays.length, 1);

  await page.setInputFiles("#restore-input", { name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"stays":"nope"}') });
  await page.locator(".toast.error").waitFor();

  await page.setInputFiles("#restore-input", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...data, stays: [] })) });
  await page.locator(".sheet").waitFor();
  assert.match(await page.locator(".sheet").innerText(), /Apartments: 1 · Stays: 0 · Guests: 0/);
  await page.click('[data-action="restore-confirm"]');
  await page.waitForURL(/#\/$/);
  assert.equal(await page.locator(".stay-card").count(), 0);
  await page.click('[data-action="toast-action"]');
  await page.locator(".stay-card").first().waitFor();
  assert.equal(await page.locator(".stay-card").count(), 1);
});
