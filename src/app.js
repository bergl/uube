import { COUNTRIES } from "./countries.js";
import { reportDeadline } from "./deadline.js";
import { describeApiError, readDocuments } from "./extract.js";
import { PURPOSES, buildUnl, czDate, encodeCp1250, unlFileName } from "./unl.js";

const STORAGE_KEY = "ubyport-helper-v1";
const UBYPORT_URL = "https://ubyport.policie.cz/";
const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 — most accurate (~2 Kč per photo)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 — cheaper (~1 Kč per photo)",
  "claude-haiku-5-5": "Claude Haiku 5.5 — cheapest, less reliable on blurry photos",
};

// ---------------------------------------------------------------- state

const emptyProperty = () => ({
  id: uid(), label: "", idub: "", abbr: "", name: "", contact: "", district: "Praha",
  municipality: "Praha", municipalityPart: "", street: "", houseNumber: "", orientationNumber: "", zip: "",
});

const emptyGuest = () => ({
  id: uid(), surname: "", givenNames: "", birthDate: "", sex: "", nationality: "", documentType: "passport",
  documentNumber: "", issuingCountry: "", expiryDate: "", visa: "", address: "", purpose: "10", note: "",
  mrz: null, readerProblems: "",
});

let state = load();
let view = { name: "stays" };
let busy = null; // { stayId, text }
let flash = null; // { kind, text }

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return { settings: { apiKey: "", model: "claude-opus-5-5" }, properties: [], stays: [], ...saved };
  } catch {}
  return { settings: { apiKey: "", model: "claude-opus-5-5" }, properties: [], stays: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showFlash("error", "Couldn't save on this device: " + e.message);
  }
}

const findStay = (id) => state.stays.find((s) => s.id === id);
const findProperty = (id) => state.properties.find((p) => p.id === id);

// ---------------------------------------------------------------- helpers

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function niceDate(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function guestName(g) {
  return [g.givenNames, g.surname].filter(Boolean).join(" ") || "Unnamed guest";
}

function showFlash(kind, text) {
  flash = { kind, text };
  render();
}

// Errors block the export; warnings only ask for a second look.
function checkGuest(g, stay) {
  const errors = [];
  const warnings = [];
  if (!g.surname.trim()) errors.push("Surname is missing");
  if (!g.givenNames.trim()) warnings.push("No given name — fine only if the passport has none");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.birthDate)) errors.push("Date of birth is missing");
  else if (g.birthDate > today()) errors.push("Date of birth is in the future");
  if (!g.nationality) errors.push("Nationality is missing");
  else if (!COUNTRIES[g.nationality]) errors.push(`Nationality code "${g.nationality}" isn't in the Ubyport list`);
  if (g.nationality === "CZE") errors.push("Czech citizens are not reported to Ubyport — remove this guest");
  const doc = g.documentNumber.trim();
  if (!doc) errors.push("Document number is missing");
  else if (doc.length < 4 || doc.length > 30) errors.push("Document number must be 4–30 characters");
  if (!g.address.trim()) errors.push("Home address (abroad) is missing — ask the guest");
  if (g.mrz && !g.mrz.valid) warnings.push("Passport code (MRZ) check failed — compare number and birth date with the photo");
  if (g.mrz?.mismatches?.length) warnings.push("Corrected from the passport code: " + g.mrz.mismatches.join("; "));
  if (g.expiryDate && stay?.arrival && g.expiryDate < stay.arrival) warnings.push("Document had expired before arrival");
  if (g.readerProblems) warnings.push("Reader note: " + g.readerProblems);
  return { errors, warnings };
}

function checkStay(stay) {
  const errors = [];
  const property = findProperty(stay.propertyId);
  if (!property) errors.push("Choose a property");
  else if (!property.idub.trim()) errors.push(`Property "${property.label}" has no Ubyport ID (IDUB) — add it in Settings`);
  if (!stay.arrival || !stay.departure) errors.push("Arrival and departure dates are required");
  else if (stay.departure < stay.arrival) errors.push("Departure is before arrival");
  if (!stay.guests.length) errors.push("No guests yet");
  const badGuests = stay.guests.filter((g) => checkGuest(g, stay).errors.length);
  if (badGuests.length) errors.push(`${badGuests.length} guest(s) still have missing or invalid details`);
  return errors;
}

function stayStatus(stay) {
  if (stay.submittedAt) return { cls: "ok", text: "Reported" };
  const deadline = stay.arrival ? reportDeadline(stay.arrival) : null;
  const overdue = deadline && today() > deadline;
  if (stay.exportedAt) return { cls: overdue ? "bad" : "warn", text: "File made — upload & mark reported" };
  if (overdue) return { cls: "bad", text: `Overdue (was due ${niceDate(deadline)})` };
  return { cls: "warn", text: deadline ? `Report by ${niceDate(deadline)}` : "Draft" };
}

function download(filename, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    showFlash("ok", "Copied");
  } catch {
    showFlash("error", "Couldn't copy — select the text and copy it by hand");
  }
}

// ---------------------------------------------------------------- views

function render() {
  const root = document.getElementById("app");
  const html =
    view.name === "stay" ? renderStay(findStay(view.id)) : view.name === "settings" ? renderSettings() : view.name === "help" ? renderHelp() : renderStays();
  root.innerHTML = `
    <header class="top">
      <button class="brand" data-action="nav" data-view="stays">Ubyport Helper</button>
      <nav>
        <button data-action="nav" data-view="stays" class="${view.name === "stays" || view.name === "stay" ? "on" : ""}">Stays</button>
        <button data-action="nav" data-view="settings" class="${view.name === "settings" ? "on" : ""}">Settings</button>
        <button data-action="nav" data-view="help" class="${view.name === "help" ? "on" : ""}">Help</button>
      </nav>
    </header>
    ${flash ? `<div class="flash ${flash.kind}" data-action="dismiss-flash">${esc(flash.text)}</div>` : ""}
    <main>${html}</main>`;
}

function renderStays() {
  const setupMissing = [];
  if (!state.properties.length) setupMissing.push("add your apartments");
  if (!state.settings.apiKey) setupMissing.push("add an Anthropic API key (for reading passports)");
  const stays = [...state.stays].sort((a, b) => (b.arrival || "").localeCompare(a.arrival || ""));
  const open = stays.filter((s) => !s.submittedAt);
  const done = stays.filter((s) => s.submittedAt);
  const card = (s) => {
    const st = stayStatus(s);
    const p = findProperty(s.propertyId);
    return `<button class="stay-card" data-action="open-stay" data-id="${s.id}">
      <div class="row"><strong>${esc(p?.label || "No property")}</strong><span class="pill ${st.cls}">${esc(st.text)}</span></div>
      <div class="muted">${niceDate(s.arrival)} → ${niceDate(s.departure)} · ${s.guests.length} guest${s.guests.length === 1 ? "" : "s"}</div>
      <div class="muted small">${esc(s.guests.map(guestName).join(", "))}</div>
    </button>`;
  };
  return `
    ${setupMissing.length ? `<div class="notice">First, <button class="link" data-action="nav" data-view="settings">open Settings</button> to ${setupMissing.join(" and ")}.</div>` : ""}
    <button class="primary big" data-action="new-stay">+ New stay</button>
    <h2>To report ${open.length ? `<span class="count">${open.length}</span>` : ""}</h2>
    ${open.length ? open.map(card).join("") : `<p class="muted">Nothing waiting. 🎉</p>`}
    ${open.filter((s) => !checkStay(s).length).length > 1 ? `<button data-action="export-all">Download one file per apartment for all ready stays</button>` : ""}
    ${done.length ? `<details class="history"><summary>Reported (${done.length})</summary>${done.map(card).join("")}</details>` : ""}`;
}

function renderStay(stay) {
  if (!stay) return `<p>Stay not found.</p>`;
  const isBusy = busy?.stayId === stay.id;
  return `
    <button class="link back" data-action="nav" data-view="stays">← All stays</button>
    <section class="card">
      <h2>Stay</h2>
      <label>Apartment
        <select data-stay-field="propertyId">
          <option value="">— choose —</option>
          ${state.properties.map((p) => `<option value="${p.id}" ${p.id === stay.propertyId ? "selected" : ""}>${esc(p.label || p.name || "Unnamed")}</option>`).join("")}
        </select>
      </label>
      <div class="two">
        <label>Arrival<input type="date" data-stay-field="arrival" value="${esc(stay.arrival)}"></label>
        <label>Departure<input type="date" data-stay-field="departure" value="${esc(stay.departure)}"></label>
      </div>
      <div data-status="deadline">${renderDeadline(stay)}</div>
      <label>Booking note (for you, not sent)<input data-stay-field="label" value="${esc(stay.label)}" placeholder="e.g. Airbnb HM123, John's group"></label>
    </section>

    <section class="card">
      <div class="row"><h2>Guests</h2><button class="small-btn" data-action="copy-guest-message">Copy message for guest</button></div>
      <label class="upload ${isBusy ? "disabled" : ""}">
        <input type="file" accept="image/*" multiple data-action="photos" ${isBusy ? "disabled" : ""}>
        <span>${isBusy ? `<span class="spinner"></span> ${esc(busy.text)}` : "📷 Add passport / ID photos"}</span>
        <small>${isBusy ? "This takes 10–40 seconds." : "Pick one or several photos (save them from WhatsApp first). Front + back of an ID card can go together."}</small>
      </label>
      ${stay.guests.map((g, i) => renderGuest(stay, g, i)).join("")}
      <button data-action="add-guest">+ Add guest by hand</button>
    </section>

    <section class="card">
      <h2>Report to the police</h2>
      <div data-status="report">${renderReportStatus(stay)}</div>
      <ol class="steps">
        <li><button class="primary" data-action="export" ${checkStay(stay).length ? "disabled" : ""}>Download Ubyport file (.unl)</button>
          ${stay.exportedAt ? `<span class="muted small">Downloaded ${new Date(stay.exportedAt).toLocaleString()}</span>` : ""}</li>
        <li>Open <a href="${UBYPORT_URL}" target="_blank" rel="noopener">Ubyport</a>, sign in, choose <em>sending a UNL file</em> and upload it.</li>
        <li>Check the receipt (doručenka) says all records were accepted, then:
          <button data-action="toggle-submitted">${stay.submittedAt ? "↺ Mark as not reported" : "✓ Mark as reported"}</button></li>
      </ol>
      <details><summary>Or type it into the Ubyport web form instead</summary>${renderManualCopy(stay)}</details>
    </section>
    <button class="danger" data-action="delete-stay">Delete this stay</button>`;
}

function renderDeadline(stay) {
  const deadline = stay.arrival ? reportDeadline(stay.arrival) : null;
  return deadline && !stay.submittedAt
    ? `<p class="muted small">Must be reported by <strong>${niceDate(deadline)}</strong> (3 working days after arrival).</p>`
    : "";
}

function renderReportStatus(stay) {
  const errors = checkStay(stay);
  return errors.length
    ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : `<p class="ok-text">✓ Everything required is filled in.</p>`;
}

function renderGuestTitle(g, i) {
  const mrzBadge = g.mrz
    ? g.mrz.valid
      ? `<span class="pill ok" title="Check digits in the passport code match">✓ verified by passport code</span>`
      : `<span class="pill bad">⚠ passport code check failed</span>`
    : `<span class="pill muted-pill">not verified</span>`;
  return `<strong>${i + 1}. ${esc(guestName(g))}</strong>${mrzBadge}`;
}

function renderGuestStatus(stay, g) {
  const { errors, warnings } = checkGuest(g, stay);
  return (
    (errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "") +
    (warnings.length ? `<ul class="warnings">${warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "")
  );
}

function renderGuest(stay, g, i) {
  const { errors } = checkGuest(g, stay);
  const f = (field, label, attrs = "") =>
    `<label>${label}<input data-guest="${g.id}" data-field="${field}" value="${esc(g[field])}" ${attrs}></label>`;
  return `
  <div class="guest ${errors.length ? "has-errors" : ""}" data-guest-card="${g.id}">
    <div class="row" data-status="guest-title">${renderGuestTitle(g, i)}</div>
    <div class="two">
      ${f("surname", "Surname", 'autocapitalize="words"')}
      ${f("givenNames", "Given names", 'autocapitalize="words"')}
    </div>
    <div class="two">
      <label>Date of birth<input type="date" data-guest="${g.id}" data-field="birthDate" value="${esc(g.birthDate)}"></label>
      <label>Nationality
        <select data-guest="${g.id}" data-field="nationality">
          <option value="">— choose —</option>
          ${Object.entries(COUNTRIES).map(([code, name]) => `<option value="${code}" ${code === g.nationality ? "selected" : ""}>${code} – ${esc(name)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="two">
      ${f("documentNumber", "Passport / ID number", 'autocapitalize="characters" autocomplete="off"')}
      ${f("visa", "Visa number (if any)", 'autocapitalize="characters"')}
    </div>
    <label>Home address abroad
      <span class="inline">
        <input data-guest="${g.id}" data-field="address" value="${esc(g.address)}" placeholder="Street, city, country">
        <button class="small-btn" data-action="address-from-first" data-guest="${g.id}" title="Same address as guest 1">= guest 1</button>
      </span>
    </label>
    <div class="two">
      <label>Purpose of stay
        <select data-guest="${g.id}" data-field="purpose">
          ${Object.entries(PURPOSES).map(([code, name]) => `<option value="${code}" ${code === g.purpose ? "selected" : ""}>${code} – ${esc(name)}</option>`).join("")}
        </select>
      </label>
      ${f("note", "Note to police (optional)")}
    </div>
    <div data-status="guest">${renderGuestStatus(stay, g)}</div>
    <button class="link danger-link" data-action="remove-guest" data-guest="${g.id}">Remove guest</button>
  </div>`;
}

function renderManualCopy(stay) {
  if (!stay.guests.length) return `<p class="muted">Add guests first.</p>`;
  return stay.guests
    .map((g) => {
      const rows = [
        ["Ubytován od", czDate(stay.arrival)],
        ["Ubytován do", czDate(stay.departure)],
        ["Příjmení", g.surname],
        ["Jméno", g.givenNames],
        ["Datum narození", czDate(g.birthDate)],
        ["Státní občanství", g.nationality],
        ["Bydliště v domovském státě", g.address],
        ["Číslo cestovního dokladu", g.documentNumber],
        ["Číslo víza", g.visa],
        ["Účel pobytu", `${g.purpose} – ${PURPOSES[g.purpose] || ""}`],
      ];
      return `<table class="copy-table"><caption>${esc(guestName(g))}</caption>${rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td><td>${v ? `<button class="small-btn" data-action="copy" data-text="${esc(v)}">Copy</button>` : ""}</td></tr>`)
        .join("")}</table>`;
    })
    .join("");
}

function renderSettings() {
  const s = state.settings;
  return `
    <section class="card">
      <h2>Apartments</h2>
      <p class="muted small">Copy these from your Ubyport registration. Each apartment registered separately has its own <strong>IDUB</strong> (accommodation ID).</p>
      ${state.properties.map(renderProperty).join("")}
      <button data-action="add-property">+ Add apartment</button>
    </section>

    <section class="card">
      <h2>Passport reading</h2>
      <p class="muted small">Photos are read by Claude (Anthropic). Create an API key at
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> and add some credit (5 $ lasts a long time).
        The key is stored only on this device.</p>
      <label>Anthropic API key<input type="password" data-setting="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label>Model
        <select data-setting="model">${Object.entries(MODELS).map(([id, label]) => `<option value="${id}" ${id === s.model ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
      </label>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted small">Everything is stored only in this browser. Make a backup now and then — and before changing phones. Hosts must keep guest records for 6 years.</p>
      <div class="row-buttons">
        <button data-action="backup">Download backup</button>
        <label class="button-like">Restore backup<input type="file" accept="application/json,.json" data-action="restore" hidden></label>
      </div>
    </section>`;
}

function renderPropertySummary(p) {
  return `<strong>${esc(p.label || "New apartment")}</strong> ${p.idub ? `<span class="muted small">IDUB ${esc(p.idub)}</span>` : `<span class="pill bad">IDUB missing</span>`}`;
}

// Updates validation messages in place, leaving the inputs alone, so focus and
// the field the user is about to tap survive every keystroke.
function refreshStatus() {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  if (stay) {
    const set = (sel, html) => document.querySelectorAll(sel).forEach((el) => (el.innerHTML = html));
    set('[data-status="report"]', renderReportStatus(stay));
    set('[data-status="deadline"]', renderDeadline(stay));
    const exportBtn = document.querySelector('[data-action="export"]');
    if (exportBtn) exportBtn.disabled = checkStay(stay).length > 0;
    stay.guests.forEach((g, i) => {
      const card = document.querySelector(`[data-guest-card="${g.id}"]`);
      if (!card) return;
      card.classList.toggle("has-errors", checkGuest(g, stay).errors.length > 0);
      card.querySelector('[data-status="guest-title"]').innerHTML = renderGuestTitle(g, i);
      card.querySelector('[data-status="guest"]').innerHTML = renderGuestStatus(stay, g);
    });
  }
  document.querySelectorAll('[data-status="property"]').forEach((el) => {
    const p = findProperty(el.dataset.id);
    if (p) el.innerHTML = renderPropertySummary(p);
  });
}

function renderProperty(p) {
  const f = (field, label, attrs = "") =>
    `<label>${label}<input data-property="${p.id}" data-field="${field}" value="${esc(p[field])}" ${attrs}></label>`;
  return `
  <details class="property" ${p.idub ? "" : "open"}>
    <summary data-status="property" data-id="${p.id}">${renderPropertySummary(p)}</summary>
    ${f("label", "Your name for it", 'placeholder="e.g. Vinohrady 2+kk"')}
    <div class="two">${f("idub", "IDUB (Ubyport ID)")}${f("abbr", "Short code (zkratka)")}</div>
    ${f("name", "Accommodation provider (ubytovatel)")}
    ${f("contact", "Contact (phone / e-mail)")}
    <div class="two">${f("district", "District (okres)")}${f("municipality", "Municipality (obec)")}</div>
    <div class="two">${f("municipalityPart", "Part of municipality (část obce)", 'placeholder="e.g. Vinohrady"')}${f("street", "Street")}</div>
    <div class="three">${f("houseNumber", "No. (č. p.)")}${f("orientationNumber", "No. (č. o.)")}${f("zip", "Postcode (PSČ)", 'inputmode="numeric"')}</div>
    <button class="link danger-link" data-action="remove-property" data-id="${p.id}">Remove apartment</button>
  </details>`;
}

function renderHelp() {
  return `
  <section class="card prose">
    <h2>How it works</h2>
    <ol>
      <li><strong>Guest sends passport photos</strong> on WhatsApp. Use “Copy message for guest” on a stay to ask for photos <em>and</em> home address.</li>
      <li>Save the photos to the phone, then on the stay tap <strong>Add passport / ID photos</strong>. Claude reads the names, dates and numbers.</li>
      <li>Check each guest. A green <em>verified by passport code</em> badge means the check digits in the machine-readable lines matched, so the number and birth date are almost certainly right. Fill in the home address.</li>
      <li>Tap <strong>Download Ubyport file</strong>, open Ubyport, upload the .unl file, and check the receipt (doručenka) for rejected records.</li>
      <li>Mark the stay as reported.</li>
    </ol>
    <h3>Rules worth remembering</h3>
    <ul>
      <li>Report every guest who is <strong>not a Czech citizen</strong> (EU citizens too), within <strong>3 working days</strong> of arrival.</li>
      <li>The photos are not stored by this app — only the typed details, on this device.</li>
      <li>If Ubyport rejects a record, fix the guest here, download a new file and upload again.</li>
    </ul>
  </section>`;
}

// ---------------------------------------------------------------- actions

function guestMessage() {
  return `Hello and welcome to Prague! 🙂
Czech law requires us to register every foreign guest with the police within 3 days. Could you please send:
1) a clear photo of the photo page of each guest's passport or ID card (for ID cards, front and back), taken flat, without glare, with all 4 corners visible
2) your home address (street, city, country)
Thank you!`;
}

function exportFiles(stays) {
  const byProperty = new Map();
  for (const stay of stays) {
    if (!byProperty.has(stay.propertyId)) byProperty.set(stay.propertyId, []);
    byProperty.get(stay.propertyId).push(stay);
  }
  const now = new Date();
  const lossy = new Set();
  for (const [propertyId, group] of byProperty) {
    const property = findProperty(propertyId);
    const entries = group.flatMap((stay) => stay.guests.map((guest) => ({ stay, guest })));
    const { bytes, lossy: l } = encodeCp1250(buildUnl(property, entries, now));
    l.forEach((c) => lossy.add(c));
    download(unlFileName(property, now), bytes, "text/plain;charset=windows-1250");
    group.forEach((s) => (s.exportedAt = now.toISOString()));
  }
  save();
  showFlash(
    lossy.size ? "error" : "ok",
    lossy.size
      ? `Downloaded, but these characters can't be sent to Ubyport and became "?": ${[...lossy].join(" ")}. Retype those names in Latin letters.`
      : `Downloaded ${byProperty.size} file${byProperty.size === 1 ? "" : "s"}. Now upload in Ubyport.`,
  );
}

async function addPhotos(stay, files) {
  if (!files.length) return;
  if (!state.settings.apiKey) return showFlash("error", "Add your Anthropic API key in Settings first.");
  busy = { stayId: stay.id, text: `Reading ${files.length} photo${files.length === 1 ? "" : "s"}…` };
  flash = null;
  render();
  try {
    const { guests, unusable } = await readDocuments(files, state.settings);
    for (const g of guests) stay.guests.push({ ...emptyGuest(), ...g, id: uid() });
    save();
    busy = null;
    const parts = [`Found ${guests.length} document${guests.length === 1 ? "" : "s"}. Please check the details.`];
    if (unusable.length) parts.push("Skipped: " + unusable.join("; "));
    showFlash(guests.length ? "ok" : "error", parts.join(" "));
  } catch (err) {
    busy = null;
    showFlash("error", describeApiError(err));
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT") return;
  const action = el.dataset.action;
  const stay = view.name === "stay" ? findStay(view.id) : null;

  switch (action) {
    case "nav":
      view = { name: el.dataset.view };
      flash = null;
      break;
    case "dismiss-flash":
      flash = null;
      break;
    case "new-stay": {
      const s = { id: uid(), propertyId: state.properties.length === 1 ? state.properties[0].id : "", arrival: today(), departure: "", label: "", guests: [], createdAt: new Date().toISOString() };
      state.stays.push(s);
      save();
      view = { name: "stay", id: s.id };
      break;
    }
    case "open-stay":
      view = { name: "stay", id: el.dataset.id };
      flash = null;
      break;
    case "add-guest":
      stay.guests.push(emptyGuest());
      save();
      break;
    case "remove-guest": {
      const g = stay.guests.find((x) => x.id === el.dataset.guest);
      if (!confirm(`Remove ${guestName(g)}?`)) return;
      stay.guests = stay.guests.filter((x) => x.id !== g.id);
      save();
      break;
    }
    case "address-from-first": {
      const g = stay.guests.find((x) => x.id === el.dataset.guest);
      const first = stay.guests.find((x) => x.address.trim());
      if (first && g) g.address = first.address;
      save();
      break;
    }
    case "export":
      if (!checkStay(stay).length) exportFiles([stay]);
      return;
    case "export-all":
      exportFiles(state.stays.filter((s) => !s.submittedAt && !checkStay(s).length));
      return;
    case "toggle-submitted":
      stay.submittedAt = stay.submittedAt ? null : new Date().toISOString();
      save();
      if (stay.submittedAt) {
        view = { name: "stays" };
        flash = { kind: "ok", text: "Marked as reported." };
      }
      break;
    case "delete-stay":
      if (!confirm("Delete this stay and its guests from this device? Hosts must keep guest records for 6 years.")) return;
      state.stays = state.stays.filter((s) => s.id !== stay.id);
      save();
      view = { name: "stays" };
      break;
    case "copy-guest-message":
      copy(guestMessage());
      return;
    case "copy":
      copy(el.dataset.text);
      return;
    case "add-property":
      state.properties.push(emptyProperty());
      save();
      break;
    case "remove-property": {
      const used = state.stays.some((s) => s.propertyId === el.dataset.id);
      if (!confirm(used ? "Some stays use this apartment. Remove it anyway?" : "Remove this apartment?")) return;
      state.properties = state.properties.filter((p) => p.id !== el.dataset.id);
      save();
      break;
    }
    case "backup":
      download(`ubyport-helper-backup-${today()}.json`, JSON.stringify({ ...state, settings: { ...state.settings, apiKey: "" } }, null, 2), "application/json");
      return;
    default:
      return;
  }
  render();
});

// Typing updates state and the status messages, never the inputs themselves.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.guest && el.dataset.field) {
    const g = findStay(view.id)?.guests.find((x) => x.id === el.dataset.guest);
    if (g) g[el.dataset.field] = el.value;
  } else if (el.dataset.stayField) {
    const s = findStay(view.id);
    if (s) s[el.dataset.stayField] = el.value;
  } else if (el.dataset.property) {
    const p = findProperty(el.dataset.property);
    if (p) p[el.dataset.field] = el.value;
  } else if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.value.trim();
  } else return;
  save();
  refreshStatus();
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset.action === "photos") {
    const files = [...el.files];
    el.value = "";
    await addPhotos(findStay(view.id), files);
    return;
  }
  if (el.dataset.action === "restore") {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.stays) || !Array.isArray(data.properties)) throw new Error("not a backup file");
      if (!confirm(`Replace everything on this device with the backup (${data.stays.length} stays)?`)) return;
      state = { ...data, settings: { ...data.settings, apiKey: state.settings.apiKey } };
      save();
      showFlash("ok", "Backup restored.");
    } catch (err) {
      showFlash("error", "Couldn't restore: " + err.message);
    }
    return;
  }
  // Selects and some date pickers only fire "change"; record the value here too.
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

render();
