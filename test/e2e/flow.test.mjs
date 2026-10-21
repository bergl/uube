import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PNG_1PX, downloadText, openApp } from "./helpers.mjs";

let app;
before(async () => (app = await openApp()));
after(async () => {
  assert.deepEqual(app.errors, [], "the page logged errors");
  await app.close();
});

const fillApartment = async (page) => {
  await page.click('.tab[data-view="settings"]');
  await page.click('[data-action="add-property"]');
  const f = (field, value) => page.fill(`[data-property][data-field="${field}"]`, value);
  await f("label", "Vinohrady 2+kk");
  await f("idub", "123456789");
  await f("name", "Jana Nováková");
  await f("street", "Mánesova");
  await f("houseNumber", "1234");
  await f("zip", "12000");
  await page.fill('[data-setting="apiKey"]', "sk-ant-test");
};

test("a stay goes from photos to a confirmed report", async () => {
  const { page } = app;
  await fillApartment(page);
  await page.click(".fab");
  const departure = page.locator('[data-stay-field="departure"]');
  await departure.fill("2026-10-25");
  await departure.dispatchEvent("change");

  await page.setInputFiles('input[data-action="photos"]', [
    { name: "a.png", mimeType: "image/png", buffer: PNG_1PX },
    { name: "b.png", mimeType: "image/png", buffer: PNG_1PX },
  ]);
  await page.locator(".guest").nth(1).waitFor();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].messages[0].content.filter((b) => b.type === "image").length, 2);

  // The misread passport number was fixed from the passport code.
  assert.equal(await page.locator('[data-field="documentNumber"]').first().inputValue(), "C01X00T47");
  assert.equal(await page.locator(".guest .pill.ok").count(), 2, "both passports pass the check digits");

  // Export stays blocked until addresses are filled and both guests are reviewed.
  assert.ok(await page.isDisabled('[data-action="export"]'));
  await page.locator('[data-field="address"]').nth(0).fill("12 Baker Street, London");
  await page.locator('[data-field="address"]').nth(1).fill("12 Baker Street, London");
  assert.ok(await page.isDisabled('[data-action="export"]'), "unreviewed guests block the export");
  await page.locator('[data-action="review-guest"]').first().click();
  await page.locator('[data-action="review-guest"]').first().click();
  assert.equal(await page.locator(".reviewed").count(), 2);

  const first = await downloadText(page, () => page.click('[data-action="export"]'), "windows-1250");
  assert.match(first.name, /^123456789_\d{12}\.unl$/);
  const lines = first.text.split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^A\|2\|123456789\|\|Jana Nováková\|/);
  assert.match(lines[1], /^U\|\d\d\.\d\d\.\d{4}\|25\.10\.2026\|Müller\|Hans Peter\|\|14\.03\.1985\|\|\|DEU\|12 Baker Street, London\|C01X00T47\|\|10\|\|$/);

  // Changing reportable data after the export is noticed and un-reviews that guest.
  await page.locator('[data-field="address"]').nth(1).fill("1 Abbey Road, London");
  await page.locator(".banner.warn").waitFor();
  assert.ok(await page.isDisabled('[data-action="export"]'));
  await page.locator('[data-action="review-guest"]').click();
  assert.match(await page.locator('[data-action="export"]').innerText(), /Download updated file/);
  const second = await downloadText(page, () => page.click('[data-action="export"]'), "windows-1250");
  assert.match(second.text, /1 Abbey Road, London/);

  // Reporting needs an explicit confirmation of the receipt.
  await page.click('[data-action="open-report-sheet"]');
  assert.ok(await page.isDisabled('[data-action="confirm-report"]'));
  await page.check('[data-sheet-field="checked"]');
  await page.fill('[data-sheet-field="ref"]', "R-2041");
  await page.click('[data-action="confirm-report"]');
  await page.locator(".history summary").click();
  assert.match(await page.locator(".history .stay-card").innerText(), /Reported/);
});

test("editing a reported stay reopens it and re-checks the passport code", async () => {
  const { page } = app;
  await page.locator(".history .stay-card").click();
  await page.locator('[data-field="documentNumber"]').first().fill("C01X00T48");
  await page.locator(".guest .pill.warn").first().waitFor();
  assert.match(await page.locator(".guest .pill.warn").first().innerText(), /Differs from passport code/);
  await page.locator(".banner.bad").waitFor();
  await page.click(".back");
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

  await page.setInputFiles('input[data-action="restore"]', { name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"stays":"nope"}') });
  await page.locator(".toast.error").waitFor();

  const smaller = { ...data, stays: [] };
  await page.setInputFiles('input[data-action="restore"]', { name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(smaller)) });
  await page.locator(".sheet").waitFor();
  assert.match(await page.locator(".sheet").innerText(), /Apartments: 1 · Stays: 0 · Guests: 0/);
  await page.click('[data-action="restore-confirm"]');
  assert.equal(await page.locator(".stay-card").count(), 0);
  await page.click('[data-action="toast-action"]');
  await page.locator(".stay-card").first().waitFor();
  assert.equal(await page.locator(".stay-card").count(), 1);
});
