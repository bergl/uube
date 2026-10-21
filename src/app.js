import { COUNTRIES } from "./countries.js";
import { COUNTRY_INFO } from "./country-names.js";
import { reportDeadline } from "./deadline.js";
import { apiErrorKey, readDocuments } from "./extract.js";
import { DEFAULT_LANG, LANGS, getLang, locale, setLang, t, tIn } from "./i18n.js";
import { skylineSvg } from "./scenery.js";
import { DEFAULT_THEME, THEMES, applyTheme } from "./themes.js";
import { PURPOSE_CODES, buildUnl, czDate, encodeCp1250, unlFileName } from "./unl.js";

const STORAGE_KEY = "ubyport-helper-v1";
const UBYPORT_URL = "https://ubyport.policie.cz/";
const MODELS = { "claude-opus-5-5": "model.opus", "claude-sonnet-5-5": "model.sonnet", "claude-haiku-5-5": "model.haiku" };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>',
  cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6"/><circle cx="12" cy="16.9" r=".6" fill="currentColor"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 18.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H8.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
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

const defaultSettings = () => ({ apiKey: "", model: "claude-opus-5-5", theme: DEFAULT_THEME, lang: "" });

let state = load();
let view = { name: "stays" };
let busy = null; // { stayId }
let flash = null; // { kind, text }
let lastViewKey = null;
let shownFlash = null;
let toastTimer = null;
let scanTimer = null;
const freshGuests = new Set();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return { properties: [], stays: [], ...saved, settings: { ...defaultSettings(), ...saved.settings } };
  } catch {}
  return { settings: defaultSettings(), properties: [], stays: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showFlash("error", t("toast.saveFailed", { msg: e.message }));
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

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

function niceDate(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

function guestName(g) {
  return [g.givenNames, g.surname].filter(Boolean).join(" ") || t("guest.unnamed");
}

function countryName(code) {
  return COUNTRY_INFO[code]?.[getLang()] || COUNTRIES[code] || code;
}

function flag(code) {
  const a2 = COUNTRY_INFO[code]?.a2;
  return a2 ? String.fromCodePoint(...[...a2].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
}

function avatar(g) {
  const name = guestName(g);
  const initials = ((g.givenNames[0] || "") + (g.surname[0] || "")).toUpperCase() || "?";
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="avatar" style="--h:${hue}" aria-hidden="true">${esc(initials)}</span>`;
}

function showFlash(kind, text) {
  flash = { kind, text };
  render();
}

function greeting() {
  const h = new Date().getHours();
  return t(h < 5 ? "greet.night" : h < 11 ? "greet.morning" : h < 18 ? "greet.day" : h < 23 ? "greet.evening" : "greet.night");
}

// Errors block the export; warnings only ask for a second look.
function checkGuest(g, stay) {
  const errors = [];
  const warnings = [];
  if (!g.surname.trim()) errors.push(t("v.surname"));
  if (!g.givenNames.trim()) warnings.push(t("v.givenNames"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.birthDate)) errors.push(t("v.birthMissing"));
  else if (g.birthDate > today()) errors.push(t("v.birthFuture"));
  if (!g.nationality) errors.push(t("v.nationalityMissing"));
  else if (!COUNTRIES[g.nationality]) errors.push(t("v.nationalityUnknown", { code: g.nationality }));
  if (g.nationality === "CZE") errors.push(t("v.czech"));
  const doc = g.documentNumber.trim();
  if (!doc) errors.push(t("v.docMissing"));
  else if (doc.length < 4 || doc.length > 30) errors.push(t("v.docLength"));
  if (!g.address.trim()) errors.push(t("v.address"));
  if (g.mrz && !g.mrz.valid) warnings.push(t("v.mrzFailed"));
  const fixes = (g.mrz?.mismatches || []).filter((m) => typeof m === "object");
  if (fixes.length) warnings.push(t("v.corrected", { list: fixes.map((m) => `${t("m." + m.field)} “${m.from}” → “${m.to}”`).join("; ") }));
  if (g.expiryDate && stay?.arrival && g.expiryDate < stay.arrival) warnings.push(t("v.expired"));
  if (g.readerProblems) warnings.push(t("v.readerNote", { note: g.readerProblems }));
  return { errors, warnings };
}

function checkStay(stay) {
  const errors = [];
  const property = findProperty(stay.propertyId);
  if (!property) errors.push(t("s.chooseProperty"));
  else if (!property.idub.trim()) errors.push(t("s.noIdub", { name: property.label || property.name }));
  if (!stay.arrival || !stay.departure) errors.push(t("s.dates"));
  else if (stay.departure < stay.arrival) errors.push(t("s.datesOrder"));
  if (!stay.guests.length) errors.push(t("s.noGuests"));
  const badGuests = stay.guests.filter((g) => checkGuest(g, stay).errors.length).length;
  if (badGuests) errors.push(t("s.badGuests", { n: badGuests }));
  return errors;
}

function stayStatus(stay) {
  if (stay.submittedAt) return { cls: "ok", text: t("status.reported") };
  const deadline = stay.arrival ? reportDeadline(stay.arrival) : null;
  const left = deadline ? daysBetween(today(), deadline) : null;
  if (stay.exportedAt) return { cls: left !== null && left < 0 ? "bad" : "info", text: t("status.fileReady") };
  if (left === null) return { cls: "muted", text: t("status.draft") };
  if (left < 0) return { cls: "bad", text: t("status.overdue", { n: -left }) };
  if (left === 0) return { cls: "bad", text: t("status.dueToday") };
  return { cls: left === 1 ? "warn" : "calm", text: t("status.dueIn", { n: left }) };
}

function stayProgress(stay) {
  const property = findProperty(stay.propertyId);
  const details = !!property && !!stay.arrival && !!stay.departure && stay.departure >= stay.arrival;
  const guests = stay.guests.length > 0 && stay.guests.every((g) => !checkGuest(g, stay).errors.length);
  return [details, guests, !!stay.exportedAt, !!stay.submittedAt];
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
    showFlash("ok", t("toast.copied"));
  } catch {
    showFlash("error", t("toast.copyFailed"));
  }
}

function withTransition(fn) {
  if (document.startViewTransition && !reducedMotion) document.startViewTransition(fn);
  else fn();
}

function confetti() {
  if (reducedMotion) return;
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--accent-2", "--sun", "--ok"].map((v) => css.getPropertyValue(v).trim());
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.style.cssText =
      `left:${50 + (Math.random() - 0.5) * 20}%;background:${colors[i % colors.length]};` +
      `--dx:${(Math.random() - 0.5) * 600}px;--dy:${-(260 + Math.random() * 320)}px;--r:${Math.random() * 900 - 450}deg;` +
      `animation-delay:${Math.random() * 0.12}s;${i % 3 ? "" : "border-radius:50%;"}`;
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

// ---------------------------------------------------------------- layout

function mountShell() {
  document.getElementById("app").innerHTML = `
    <header class="hero">
      ${skylineSvg()}
      <div class="hero-tools">
        <button class="hero-btn" data-action="cycle-lang" aria-label="${esc(t("nav.language"))}">${ICON.globe}<span id="lang-label"></span></button>
        <button class="hero-btn" data-action="nav" data-view="help" aria-label="${esc(t("nav.help"))}">${ICON.help}</button>
      </div>
      <div class="hero-text" id="hero-text"></div>
    </header>
    <div id="toast-layer" aria-live="polite"></div>
    <main id="view"></main>
    <nav class="tabbar" id="tabbar"></nav>`;
}

function render() {
  const key = view.name + (view.id || "");
  const main = document.getElementById("view");
  const heroText = document.getElementById("hero-text");
  main.innerHTML =
    view.name === "stay" ? renderStay(findStay(view.id)) : view.name === "settings" ? renderSettings() : view.name === "help" ? renderHelp() : renderStays();
  heroText.innerHTML = renderHeroText();
  document.getElementById("lang-label").textContent = LANGS[getLang()];
  document.getElementById("tabbar").innerHTML = renderTabbar();

  if (key !== lastViewKey) {
    lastViewKey = key;
    window.scrollTo({ top: 0 });
    for (const el of [main, heroText]) {
      el.classList.remove("enter");
      void el.offsetWidth;
      el.classList.add("enter");
    }
    clearTimeout(render.enterTimer);
    render.enterTimer = setTimeout(() => [main, heroText].forEach((el) => el.classList.remove("enter")), 900);
  }
  renderToast();
  freshGuests.clear();
  syncScanner();
}

function renderHeroText() {
  if (view.name === "stay") {
    const stay = findStay(view.id);
    if (!stay) return "";
    const p = findProperty(stay.propertyId);
    return `<h1>${esc(p?.label || p?.name || t("hero.newStay"))}</h1>
      <p>${niceDate(stay.arrival)} → ${niceDate(stay.departure)} · ${t("hero.guests", { n: stay.guests.length })}</p>`;
  }
  if (view.name === "settings") return `<h1>${t("settings.title")}</h1><p>${t("settings.subtitle")}</p>`;
  if (view.name === "help") return `<h1>${t("help.title")}</h1><p>${t("help.subtitle")}</p>`;
  const open = state.stays.filter((s) => !s.submittedAt);
  let line;
  if (!state.properties.length || !state.settings.apiKey) line = t("hero.setup");
  else if (!open.length) line = t("hero.allDone");
  else {
    const next = open.map((s) => (s.arrival ? reportDeadline(s.arrival) : null)).filter(Boolean).sort()[0];
    line = t("hero.toReport", { n: open.length }) + (next ? ` · ${t("hero.nextDue", { date: niceDate(next) })}` : "");
  }
  return `<h1>${greeting()} <span class="wave">👋</span></h1><p>${esc(line)}</p>`;
}

function renderTabbar() {
  const on = (names) => (names.includes(view.name) ? "on" : "");
  return `
    <button class="tab ${on(["stays", "stay"])}" data-action="nav" data-view="stays">${ICON.home}<span>${t("nav.stays")}</span></button>
    <button class="fab" data-action="new-stay" aria-label="${esc(t("nav.newStay"))}">${ICON.plus}</button>
    <button class="tab ${on(["settings"])}" data-action="nav" data-view="settings">${ICON.cog}<span>${t("nav.settings")}</span></button>`;
}

function renderToast() {
  if (flash === shownFlash) return;
  shownFlash = flash;
  clearTimeout(toastTimer);
  const layer = document.getElementById("toast-layer");
  if (!flash) {
    layer.innerHTML = "";
    return;
  }
  layer.innerHTML = `<div class="toast ${flash.kind}" data-action="dismiss-flash" role="status">
    <span class="toast-icon">${flash.kind === "ok" ? ICON.check : "!"}</span><span>${esc(flash.text)}</span></div>`;
  if (flash.kind === "ok") {
    const mine = flash;
    toastTimer = setTimeout(() => {
      layer.firstElementChild?.classList.add("leaving");
      setTimeout(() => {
        if (flash === mine) {
          flash = shownFlash = null;
          layer.innerHTML = "";
        }
      }, 350);
    }, 3200);
  }
}

// Cycles the friendly progress messages while photos are being read.
function syncScanner() {
  if (!busy) {
    clearInterval(scanTimer);
    scanTimer = null;
    return;
  }
  if (scanTimer) return;
  let i = 1;
  scanTimer = setInterval(() => {
    const el = document.getElementById("scan-text");
    if (!el) return;
    i = Math.min(i + 1, 4);
    el.classList.remove("swap");
    void el.offsetWidth;
    el.textContent = t(`scan.${i}`);
    el.classList.add("swap");
  }, 2600);
}

// ---------------------------------------------------------------- views

function renderStays() {
  const needsProperty = !state.properties.length;
  const needsKey = !state.settings.apiKey;
  const stays = [...state.stays].sort((a, b) => (a.arrival || "9").localeCompare(b.arrival || "9"));
  const open = stays.filter((s) => !s.submittedAt);
  const done = stays.filter((s) => s.submittedAt).reverse();

  const card = (s) => {
    const st = stayStatus(s);
    const p = findProperty(s.propertyId);
    return `<button class="stay-card s-${st.cls}" data-action="open-stay" data-id="${s.id}">
      <span class="stay-top"><span class="stay-place">${esc(p?.label || p?.name || t("stay.noProperty"))}</span><span class="pill ${st.cls}">${esc(st.text)}</span></span>
      <span class="stay-dates">${niceDate(s.arrival)} <span class="arrow">→</span> ${niceDate(s.departure)}${s.label ? ` · <span class="muted">${esc(s.label)}</span>` : ""}</span>
      <span class="stay-bottom"><span class="avatars">${s.guests.slice(0, 5).map(avatar).join("")}</span>
        <span class="muted small">${t("hero.guests", { n: s.guests.length })}</span><span class="chev">›</span></span>
    </button>`;
  };

  const onboarding =
    needsProperty || needsKey
      ? `<section class="card onboarding">
          <h2>${t("onb.title")}</h2><p class="muted">${t("onb.text")}</p>
          <ol class="checklist">
            <li class="${needsProperty ? "" : "done"}"><button data-action="nav" data-view="settings"><span class="tick">${needsProperty ? "1" : ICON.check}</span>${t("onb.property")}</button></li>
            <li class="${needsKey ? "" : "done"}"><button data-action="nav" data-view="settings"><span class="tick">${needsKey ? "2" : ICON.check}</span>${t("onb.key")}</button></li>
            <li class="optional"><button data-action="nav" data-view="settings"><span class="tick">🎨</span>${t("onb.theme")}</button></li>
          </ol>
        </section>`
      : "";

  const empty = !stays.length
    ? `<div class="empty"><div class="empty-art">${skylineSvg(3)}</div><h3>${t("list.emptyTitle")}</h3><p class="muted">${t("list.emptyText")}</p>
        <button class="primary" data-action="new-stay">${ICON.plus}${t("nav.newStay")}</button></div>`
    : "";

  return `
    ${onboarding}
    ${empty}
    ${stays.length ? `<h2 class="section-title">${t("list.toReport")} ${open.length ? `<span class="count">${open.length}</span>` : ""}</h2>` : ""}
    ${stays.length && !open.length ? `<p class="all-done">${t("list.allDone")}</p>` : ""}
    <div class="stack">${open.map(card).join("")}</div>
    ${open.filter((s) => !checkStay(s).length).length > 1 ? `<button class="wide" data-action="export-all">${ICON.download}${t("list.exportAll")}</button>` : ""}
    ${done.length ? `<details class="history"><summary>${t("list.reported", { n: done.length })}</summary><div class="stack">${done.map(card).join("")}</div></details>` : ""}`;
}

function renderStepper(stay) {
  const done = stayProgress(stay);
  const current = done.indexOf(false);
  const labels = [t("step.details"), t("step.guests"), t("step.file"), t("step.reported")];
  return `<ol class="stepper">${labels
    .map((l, i) => `<li class="${done[i] ? "done" : ""} ${current === i ? "current" : ""}"><span class="dot">${done[i] ? ICON.check : i + 1}</span><span class="lbl">${l}</span></li>`)
    .join("")}</ol>`;
}

function renderStay(stay) {
  if (!stay) return `<p>—</p>`;
  const isBusy = busy?.stayId === stay.id;
  return `
    <button class="back" data-action="nav" data-view="stays">${ICON.back}${t("nav.stays")}</button>
    <div data-status="stepper">${renderStepper(stay)}</div>

    <section class="card">
      <h2><span class="num">1</span>${t("stay.details")}</h2>
      <label>${t("stay.apartment")}
        <select data-stay-field="propertyId">
          <option value="">${t("stay.choose")}</option>
          ${state.properties.map((p) => `<option value="${p.id}" ${p.id === stay.propertyId ? "selected" : ""}>${esc(p.label || p.name || "—")}</option>`).join("")}
        </select>
      </label>
      ${state.properties.length ? "" : `<p class="hint"><button class="link" data-action="nav" data-view="settings">${t("stay.noApartments")}</button></p>`}
      <div class="two">
        <label>${t("stay.arrival")}<input type="date" data-stay-field="arrival" value="${esc(stay.arrival)}"></label>
        <label>${t("stay.departure")}<input type="date" data-stay-field="departure" value="${esc(stay.departure)}"></label>
      </div>
      <div data-status="deadline">${renderDeadline(stay)}</div>
      <label>${t("stay.note")}<input data-stay-field="label" value="${esc(stay.label)}" placeholder="${esc(t("stay.notePlaceholder"))}"></label>
    </section>

    <section class="card">
      <h2><span class="num">2</span>${t("stay.guests")}</h2>
      <div class="ask">
        <span class="muted small">${ICON.chat}${t("stay.askGuest")}</span>
        <span class="chips">${Object.entries(LANGS).map(([code, label]) => `<button class="chip" data-action="copy-guest-message" data-lang="${code}">${label}</button>`).join("")}</span>
      </div>
      ${isBusy ? renderScanner() : `
      <label class="upload">
        <input type="file" accept="image/*" multiple data-action="photos">
        <span class="upload-icon">${passportArt()}</span>
        <span class="upload-title">${t("upload.title")}</span>
        <small>${t("upload.hint")}</small>
      </label>`}
      ${stay.guests.map((g, i) => renderGuest(stay, g, i)).join("")}
      <button class="wide ghost" data-action="add-guest">${t("stay.addByHand")}</button>
    </section>

    <section class="card">
      <h2><span class="num">3</span>${t("report.title")}</h2>
      <div data-status="report">${renderReportStatus(stay)}</div>
      <div class="rsteps">
        <div class="rstep"><span class="rnum">1</span><div>
          <button class="primary" data-action="export" ${checkStay(stay).length ? "disabled" : ""}>${ICON.download}${t("report.download")}</button>
          ${stay.exportedAt ? `<div class="muted small">${t("report.downloaded", { date: esc(new Date(stay.exportedAt).toLocaleString(locale())) })}</div>` : ""}
        </div></div>
        <div class="rstep"><span class="rnum">2</span><div>${t("report.upload", { url: UBYPORT_URL })}</div></div>
        <div class="rstep"><span class="rnum">3</span><div>${t("report.receipt")}
          <button class="${stay.submittedAt ? "" : "success"}" data-action="toggle-submitted">${stay.submittedAt ? "↺ " + t("report.markUndone") : ICON.check + t("report.markDone")}</button></div></div>
      </div>
      <details><summary>${t("report.manual")}</summary>${renderManualCopy(stay)}</details>
    </section>
    <button class="danger" data-action="delete-stay">${t("stay.delete")}</button>`;
}

function passportArt() {
  return `<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="2" width="60" height="40" rx="5" class="pp-body"/>
    <rect x="8" y="8" width="14" height="18" rx="2" class="pp-photo"/><rect x="27" y="9" width="28" height="3" rx="1.5" class="pp-line"/>
    <rect x="27" y="16" width="20" height="3" rx="1.5" class="pp-line"/><rect x="27" y="23" width="24" height="3" rx="1.5" class="pp-line"/>
    <rect x="8" y="32" width="48" height="2.4" rx="1.2" class="pp-mrz"/><rect x="8" y="36.5" width="48" height="2.4" rx="1.2" class="pp-mrz"/></svg>`;
}

function renderScanner() {
  return `<div class="scanner" role="status">
    <div class="scan-doc">${passportArt()}<span class="beam"></span></div>
    <div class="scan-text" id="scan-text">${t("scan.1")}</div>
    <small class="muted">${t("scan.time")}</small>
  </div>`;
}

function renderDeadline(stay) {
  const deadline = stay.arrival ? reportDeadline(stay.arrival) : null;
  return deadline && !stay.submittedAt ? `<p class="deadline">⏰ ${t("stay.deadline", { date: niceDate(deadline) })}</p>` : "";
}

function renderReportStatus(stay) {
  const errors = checkStay(stay);
  return errors.length
    ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    : `<p class="all-good"><svg viewBox="0 0 24 24" class="draw-check"><circle cx="12" cy="12" r="10"/><path d="m7 12.5 3.3 3.3L17 9"/></svg>${t("report.allGood")}</p>`;
}

function renderGuestTitle(g, i) {
  const badge = g.mrz
    ? g.mrz.valid
      ? `<span class="pill ok verified" title="${esc(t("guest.verifiedTitle"))}">${ICON.check}${t("guest.verified")}</span>`
      : `<span class="pill bad">⚠ ${t("guest.mrzFailed")}</span>`
    : `<span class="pill muted">${t("guest.notVerified")}</span>`;
  return `${avatar(g)}<span class="guest-name"><strong>${esc(guestName(g))}</strong>
    <span class="muted small">${g.nationality ? `${flag(g.nationality)} ${esc(countryName(g.nationality))}` : `#${i + 1}`}</span></span>${badge}`;
}

function renderGuestStatus(stay, g) {
  const { errors, warnings } = checkGuest(g, stay);
  return (
    (errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "") +
    (warnings.length ? `<ul class="warnings">${warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "")
  );
}

function nationalityOptions(selected) {
  const lang = getLang();
  return Object.keys(COUNTRIES)
    .map((code) => [code, countryName(code)])
    .sort((a, b) => a[1].localeCompare(b[1], lang))
    .map(([code, name]) => `<option value="${code}" ${code === selected ? "selected" : ""}>${flag(code)} ${esc(name)} (${code})</option>`)
    .join("");
}

function renderGuest(stay, g, i) {
  const { errors } = checkGuest(g, stay);
  const f = (field, label, attrs = "") =>
    `<label>${label}<input data-guest="${g.id}" data-field="${field}" value="${esc(g[field])}" ${attrs}></label>`;
  return `
  <div class="guest ${errors.length ? "has-errors" : ""} ${freshGuests.has(g.id) ? "pop-in" : ""}" style="--i:${i}" data-guest-card="${g.id}">
    <div class="guest-head" data-status="guest-title">${renderGuestTitle(g, i)}</div>
    <div class="two">
      ${f("surname", t("f.surname"), 'autocapitalize="words"')}
      ${f("givenNames", t("f.givenNames"), 'autocapitalize="words"')}
    </div>
    <div class="two">
      <label>${t("f.birthDate")}<input type="date" data-guest="${g.id}" data-field="birthDate" value="${esc(g.birthDate)}"></label>
      <label>${t("f.nationality")}
        <select data-guest="${g.id}" data-field="nationality"><option value="">${t("stay.choose")}</option>${nationalityOptions(g.nationality)}</select>
      </label>
    </div>
    <div class="two">
      ${f("documentNumber", t("f.documentNumber"), 'autocapitalize="characters" autocomplete="off"')}
      ${f("visa", t("f.visa"), 'autocapitalize="characters"')}
    </div>
    <label>${t("f.address")}
      <span class="inline">
        <input data-guest="${g.id}" data-field="address" value="${esc(g.address)}" placeholder="${esc(t("f.addressPlaceholder"))}">
        ${i > 0 ? `<button class="chip" data-action="address-from-first" data-guest="${g.id}" title="${esc(t("guest.sameAddressTitle"))}">${t("guest.sameAddress")}</button>` : ""}
      </span>
    </label>
    <div class="two">
      <label>${t("f.purpose")}
        <select data-guest="${g.id}" data-field="purpose">
          ${PURPOSE_CODES.map((code) => `<option value="${code}" ${code === g.purpose ? "selected" : ""}>${code} · ${esc(t("purpose." + code))}</option>`).join("")}
        </select>
      </label>
      ${f("note", t("f.note"))}
    </div>
    <div data-status="guest">${renderGuestStatus(stay, g)}</div>
    <button class="link danger-link" data-action="remove-guest" data-guest="${g.id}">${t("guest.remove")}</button>
  </div>`;
}

function renderManualCopy(stay) {
  if (!stay.guests.length) return `<p class="muted">${t("report.manualEmpty")}</p>`;
  // Labels stay in Czech: they match the fields of the Ubyport web form.
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
        ["Účel pobytu", `${g.purpose} – ${tIn("cs", "purpose." + g.purpose)}`],
      ];
      return `<table class="copy-table"><caption>${avatar(g)} ${esc(guestName(g))}</caption>${rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td><td>${v ? `<button class="chip" data-action="copy" data-text="${esc(v)}">${t("copy")}</button>` : ""}</td></tr>`)
        .join("")}</table>`;
    })
    .join("");
}

function renderSettings() {
  const s = state.settings;
  return `
    <section class="card">
      <h2>🎨 ${t("set.look")}</h2>
      <div class="theme-grid">${THEMES.map(
        (th, i) => `<button class="theme-card ${s.theme === th.id ? "selected" : ""}" data-action="set-theme" data-theme-id="${th.id}" aria-pressed="${s.theme === th.id}">
          <span class="theme-preview" data-theme="${th.id}">${skylineSvg(11 + i)}</span>
          <span class="theme-name">${t(`theme.${th.id}.name`)}<span class="theme-check">${ICON.check}</span></span>
          <span class="theme-tag">${t(`theme.${th.id}.tag`)}</span>
        </button>`,
      ).join("")}</div>
      <label>${t("set.language")}</label>
      <div class="segmented">${Object.entries(LANGS)
        .map(([code]) => `<button class="${getLang() === code ? "on" : ""}" data-action="set-lang" data-lang="${code}">${{ en: "English", cs: "Čeština", ru: "Русский" }[code]}</button>`)
        .join("")}</div>
    </section>

    <section class="card">
      <h2>🏠 ${t("set.apartments")}</h2>
      <p class="muted small">${t("set.apartmentsHint")}</p>
      ${state.properties.map(renderProperty).join("")}
      <button class="wide ghost" data-action="add-property">${t("set.addApartment")}</button>
    </section>

    <section class="card">
      <h2>🔍 ${t("set.reading")}</h2>
      <p class="muted small">${t("set.readingHint")}</p>
      <label>${t("set.apiKey")}<input type="password" data-setting="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label>${t("set.model")}
        <select data-setting="model">${Object.entries(MODELS).map(([id, key]) => `<option value="${id}" ${id === s.model ? "selected" : ""}>${esc(t(key))}</option>`).join("")}</select>
      </label>
    </section>

    <section class="card">
      <h2>💾 ${t("set.backup")}</h2>
      <p class="muted small">${t("set.backupHint")}</p>
      <div class="row-buttons">
        <button data-action="backup">${ICON.download}${t("set.download")}</button>
        <label class="button-like">${t("set.restore")}<input type="file" accept="application/json,.json" data-action="restore" hidden></label>
      </div>
    </section>`;
}

function renderPropertySummary(p) {
  return `<strong>${esc(p.label || p.name || t("set.newApartment"))}</strong> ${
    p.idub ? `<span class="muted small">IDUB ${esc(p.idub)}</span>` : `<span class="pill bad">${t("set.idubMissing")}</span>`
  }`;
}

function renderProperty(p) {
  const f = (field, label, attrs = "") =>
    `<label>${t(label)}<input data-property="${p.id}" data-field="${field}" value="${esc(p[field])}" ${attrs}></label>`;
  return `
  <details class="property" ${p.idub ? "" : "open"}>
    <summary data-status="property" data-id="${p.id}">${renderPropertySummary(p)}</summary>
    ${f("label", "p.label", `placeholder="${esc(t("p.labelPlaceholder"))}"`)}
    <div class="two">${f("idub", "p.idub")}${f("abbr", "p.abbr")}</div>
    ${f("name", "p.name")}
    ${f("contact", "p.contact")}
    <div class="two">${f("district", "p.district")}${f("municipality", "p.municipality")}</div>
    <div class="two">${f("municipalityPart", "p.municipalityPart", `placeholder="${esc(t("p.municipalityPartPlaceholder"))}"`)}${f("street", "p.street")}</div>
    <div class="three">${f("houseNumber", "p.houseNumber")}${f("orientationNumber", "p.orientationNumber")}${f("zip", "p.zip", 'inputmode="numeric"')}</div>
    <button class="link danger-link" data-action="remove-property" data-id="${p.id}">${t("set.removeApartment")}</button>
  </details>`;
}

function renderHelp() {
  const steps = ["📱", "📷", "🔍", "⬆️", "🎉"];
  return `
  <section class="card prose">
    <ol class="help-steps">${steps.map((icon, i) => `<li style="--i:${i}"><span class="help-icon">${icon}</span><span>${t(`help.s${i + 1}`)}</span></li>`).join("")}</ol>
  </section>
  <section class="card prose">
    <h2>💡 ${t("help.rules")}</h2>
    <ul>${[1, 2, 3].map((i) => `<li>${t(`help.r${i}`)}</li>`).join("")}</ul>
  </section>`;
}

// Updates validation messages in place, leaving the inputs alone, so focus and
// the field the user is about to tap survive every keystroke.
function refreshStatus() {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  if (stay) {
    const set = (sel, html) => document.querySelectorAll(sel).forEach((el) => (el.innerHTML = html));
    set('[data-status="report"]', renderReportStatus(stay));
    set('[data-status="deadline"]', renderDeadline(stay));
    set('[data-status="stepper"]', renderStepper(stay));
    document.getElementById("hero-text").innerHTML = renderHeroText();
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

// ---------------------------------------------------------------- actions

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
  if (lossy.size) showFlash("error", t("toast.lossy", { chars: [...lossy].join(" ") }));
  else showFlash("ok", t("toast.downloaded", { n: byProperty.size }));
}

async function addPhotos(stay, files) {
  if (!files.length) return;
  if (!state.settings.apiKey) return showFlash("error", t("toast.needKey"));
  busy = { stayId: stay.id };
  flash = null;
  render();
  try {
    const { guests, unusable } = await readDocuments(files, { ...state.settings, noteLanguage: t("noteLanguage") });
    for (const g of guests) {
      const guest = { ...emptyGuest(), ...g, id: uid() };
      freshGuests.add(guest.id);
      stay.guests.push(guest);
    }
    save();
    busy = null;
    const parts = [guests.length ? t("toast.found", { n: guests.length }) : t("toast.foundNone")];
    if (unusable.length) parts.push(t("toast.skipped", { list: unusable.join("; ") }));
    showFlash(guests.length ? "ok" : "error", parts.join(" · "));
  } catch (err) {
    busy = null;
    const { key, detail } = apiErrorKey(err);
    showFlash("error", t(key, { detail }));
  }
}

function changeLanguage(code) {
  state.settings.lang = code;
  setLang(code);
  save();
  mountShell();
  lastViewKey = null;
  shownFlash = undefined;
  render();
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
    case "add-guest": {
      const g = emptyGuest();
      freshGuests.add(g.id);
      stay.guests.push(g);
      save();
      break;
    }
    case "remove-guest": {
      const g = stay.guests.find((x) => x.id === el.dataset.guest);
      if (!confirm(t("confirm.removeGuest", { name: guestName(g) }))) return;
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
        flash = { kind: "ok", text: t("toast.reported") };
        confetti();
      }
      break;
    case "delete-stay":
      if (!confirm(t("confirm.deleteStay"))) return;
      state.stays = state.stays.filter((s) => s.id !== stay.id);
      save();
      view = { name: "stays" };
      break;
    case "copy-guest-message":
      copy(tIn(el.dataset.lang, "guestMessage"));
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
      if (!confirm(t(used ? "confirm.removeUsedApartment" : "confirm.removeApartment"))) return;
      state.properties = state.properties.filter((p) => p.id !== el.dataset.id);
      save();
      break;
    }
    case "set-theme":
      state.settings.theme = el.dataset.themeId;
      save();
      withTransition(() => {
        applyTheme(state.settings.theme);
        document.querySelectorAll(".theme-card").forEach((c) => {
          const on = c.dataset.themeId === state.settings.theme;
          c.classList.toggle("selected", on);
          c.setAttribute("aria-pressed", on);
        });
      });
      return;
    case "set-lang":
      changeLanguage(el.dataset.lang);
      return;
    case "cycle-lang": {
      const codes = Object.keys(LANGS);
      changeLanguage(codes[(codes.indexOf(getLang()) + 1) % codes.length]);
      return;
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
      if (!Array.isArray(data.stays) || !Array.isArray(data.properties)) throw new Error(t("toast.notBackup"));
      if (!confirm(t("confirm.restore", { n: data.stays.length }))) return;
      state = { ...data, settings: { ...defaultSettings(), ...data.settings, apiKey: state.settings.apiKey } };
      save();
      applyTheme(state.settings.theme);
      changeLanguage(state.settings.lang || getLang());
      showFlash("ok", t("toast.restored"));
    } catch (err) {
      showFlash("error", t("toast.restoreFailed", { msg: err.message }));
    }
    return;
  }
  // Selects and some date pickers only fire "change"; record the value here too.
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

setLang(state.settings.lang || DEFAULT_LANG);
applyTheme(state.settings.theme);
mountShell();
render();
