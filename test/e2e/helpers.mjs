import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { checkDigit } from "../../src/mrz.js";

const DIST = new URL("../../dist/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// Serves dist/ the way GitHub Pages does.
export async function serveDist() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
    try {
      const body = await readFile(join(DIST, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

export function td3(surname, given, nat, doc, dob) {
  const l1 = `P<${nat}${surname}<<${given.replace(/ /g, "<")}`.padEnd(44, "<");
  let l2 = doc + checkDigit(doc) + nat + dob + checkDigit(dob) + "M" + "310101" + checkDigit("310101") + "<".repeat(15);
  l2 += checkDigit(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43));
  return [l1, l2];
}

// Two guests: the first was misread on the photo (letter O for zero), which the passport code corrects.
export const EXTRACTION = {
  documents: [
    { surname: "Müller", given_names: "Hans Peter", date_of_birth: "1985-03-14", sex: "M", nationality: "DEU", document_type: "passport", document_number: "C01X0OT47", issuing_country: "DEU", expiry_date: "2031-01-01", mrz_lines: td3("MUELLER", "HANS PETER", "D<<", "C01X00T47", "850314"), image_indexes: [1], problems: "" },
    { surname: "Smith", given_names: "Emily", date_of_birth: "1992-06-11", sex: "F", nationality: "GBR", document_type: "passport", document_number: "533401218", issuing_country: "GBR", expiry_date: "2033-04-20", mrz_lines: td3("SMITH", "EMILY", "GBR", "533401218", "920611"), image_indexes: [2], problems: "" },
  ],
  unusable_images: [],
};

export const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export async function openApp({ viewport = { width: 390, height: 844 }, extraction = EXTRACTION, delayMs = 0, colorScheme = "light", settings = {}, failWith = null } = {}) {
  const server = await serveDist();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true, locale: "en-US", colorScheme });
  const errors = [];
  const requests = [];
  await context.route("https://api.anthropic.com/**", async (route) => {
    requests.push(JSON.parse(route.request().postData()));
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (failWith) {
      return route.fulfill({ status: failWith.status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "request-id": "req_test" }, body: JSON.stringify(failWith.body) }).catch(() => {});
    }
    // The page may have cancelled the request in the meantime.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(extraction) }], usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }).catch(() => {});
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // The browser logs every failed request; tests that simulate API errors expect those.
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  await page.goto(server.url);
  await page.evaluate((s) => localStorage.setItem("ubyport-helper-v1", JSON.stringify({ version: 2, settings: { lang: "en", ...s }, properties: [], stays: [] })), settings);
  await page.reload();
  return {
    page, context, errors, requests, url: server.url,
    async close() {
      await browser.close();
      server.close();
    },
  };
}

export async function downloadText(page, click, encoding = "utf-8") {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return { name: download.suggestedFilename(), text: new TextDecoder(encoding).decode(Buffer.concat(chunks)) };
}

export async function addApartment(page, { apiKey = "sk-ant-test" } = {}) {
  await page.click('.tab[data-view="settings"]');
  await page.click('[data-action="add-property"]');
  const f = (field, value) => page.fill(`[data-property][data-field="${field}"]`, value);
  await f("label", "Vinohrady 2+kk");
  await f("idub", "123456789");
  await f("name", "Jana Nováková");
  await f("street", "Mánesova");
  await f("houseNumber", "1234");
  await f("zip", "12000");
  if (apiKey) await page.fill('[data-setting="apiKey"]', apiKey);
}

export const photoFiles = (n = 2) => Array.from({ length: n }, (_, i) => ({ name: `p${i}.png`, mimeType: "image/png", buffer: PNG_1PX }));

// Only open guest cards show their fields.
export const openCard = (page) => page.locator(".guest.open");
