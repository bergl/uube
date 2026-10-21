import { COUNTRIES } from "./countries.js";
import { COUNTRY_INFO } from "./country-names.js";
import { reportDeadline } from "./deadline.js";
import { apiErrorKey, readDocuments } from "./extract.js";
import { DEFAULT_LANG, LANGS, getLang, locale, setLang, t, tIn } from "./i18n.js";
import { skylineSvg } from "./scenery.js";
import { BEFORE_RESTORE_KEY, backupPayload, createSaver, load, requestPersistence, validateBackup } from "./store.js";
import { THEMES, applyTheme } from "./themes.js";
import { PURPOSE_CODES, buildUnl, czDate, encodeCp1250, unlFileName } from "./unl.js";
import { guestFingerprint, guestIssues, isReviewed, mrzState, propertyIssues, stayFingerprint, stayIssues, stayLossy, stayStage } from "./validate.js";

const UBYPORT_URL = "https://ubyport.policie.cz/";
const MODELS = { "claude-opus-5-5": "model.opus", "claude-sonnet-5-5": "model.sonnet", "claude-haiku-5-5": "model.haiku" };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DAY = 86400000;

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
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6z"/></svg>',
};

// ---------------------------------------------------------------- state

const emptyProperty = () => ({
  id: uid(), label: "", idub: "", abbr: "", name: "", contact: "", district: "Praha",
  municipality: "Praha", municipalityPart: "", street: "", houseNumber: "", orientationNumber: "", zip: "",
});

const emptyGuest = () => ({
  id: uid(), surname: "", givenNames: "", birthDate: "", sex: "", nationality: "", documentType: "passport",
  documentNumber: "", issuingCountry: "", expiryDate: "", visa: "", address: "", purpose: "10", note: "",
  mrz: null, mrzLines: [], readerProblems: "", reviewedFp: "",
});

let state = load();
let view = { name: "stays" };
let busy = null; // { stayId }
let flash = null; // { kind, text, action?: { label, run } }
let sheet = null; // in-app dialog, see renderSheet()
let lastViewKey = null;
let shownFlash = null;
let shownSheet = null;
let toastTimer = null;
let scanTimer = null;
let saveStatus = "saved";
let storageMode = "unsupported";
const freshGuests = new Set();

const saver = createSaver(() => state, (status, err) => {
  saveStatus = status;
  const el = document.getElementById("save-status");
  if (el) el.innerHTML = renderSaveStatus();
  if (status === "error") showFlash("error", t("toast.saveFailed", { msg: err?.message || "" }));
});
const save = () => saver.soon();
const saveNow = () => saver.now();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const findStay = (id) => state.stays.find((s) => s.id === id);
const findProperty = (id) => state.properties.find((p) => p.id === id);

// Counts work that a backup doesn't cover yet, for the backup reminder.
function noteChange() {
  state.settings.changesSinceBackup = (state.settings.changesSinceBackup || 0) + 1;
}

// ---------------------------------------------------------------- helpers

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);
}

function niceDate(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

const niceDateTime = (iso) => new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

function showFlash(kind, text, action) {
  flash = { kind, text, action };
  render();
}

function greeting() {
  const h = new Date().getHours();
  return t(h < 5 ? "greet.night" : h < 11 ? "greet.morning" : h < 18 ? "greet.day" : h < 23 ? "greet.evening" : "greet.night");
}

const FIELD_LABEL = {
  surname: "f.surname", givenNames: "f.givenNames", birthDate: "f.birthDate", nationality: "f.nationality",
  documentNumber: "f.documentNumber", address: "f.address", note: "f.note",
};

function issueText(issue) {
  const text = esc(t("v." + issue.code, issue.params || {}));
  return issue.field && FIELD_LABEL[issue.field] && issue.level === "warn" ? `<b>${t(FIELD_LABEL[issue.field])}:</b> ${text}` : text;
}

const stageOf = (stay) => stayStage(stay, findProperty(stay.propertyId), today());
const isOpen = (stay) => stageOf(stay) !== "reported";
const currentFp = (stay) => {
  const p = findProperty(stay.propertyId);
  return p ? stayFingerprint(stay, p) : "";
};

const STAGE_CLASS = { draft: "muted", review: "warn", ready: "info", exported: "info", changed: "warn", reported: "ok", changedAfterReport: "bad" };

function deadlineInfo(stay) {
  if (!stay.arrival || stageOf(stay) === "reported") return null;
  const left = daysBetween(today(), reportDeadline(stay.arrival));
  if (left < 0) return { cls: "bad", text: t("status.overdue", { n: -left }) };
  if (left === 0) return { cls: "bad", text: t("status.dueToday") };
  return { cls: left === 1 ? "warn" : "calm", text: t("status.dueIn", { n: left }) };
}

function stayProgress(stay) {
  const issues = stayIssues(stay, findProperty(stay.propertyId), today());
  const stage = stageOf(stay);
  const details = !issues.some((i) => ["chooseProperty", "noIdub", "dates", "datesInvalid", "datesOrder"].includes(i.code));
  const guests = stay.guests.length > 0 && !issues.some((i) => ["badGuests", "unreviewed", "noGuests"].includes(i.code));
  const file = !!stay.export && stay.export.fp === currentFp(stay);
  return [details, guests, file || stage === "reported", stage === "reported"];
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
    <nav class="tabbar" id="tabbar"></nav>
    <div id="sheet-layer"></div>`;
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
  renderSheet();
  freshGuests.clear();
  syncScanner();
}

function renderSaveStatus() {
  return saveStatus === "error" ? `⚠ ${t("save.error")}` : saveStatus === "saving" ? t("save.saving") : `${ICON.check}${t("save.saved")}`;
}

function renderHeroText() {
  const saved = `<p class="save-status" id="save-status" aria-live="polite">${renderSaveStatus()}</p>`;
  if (view.name === "stay") {
    const stay = findStay(view.id);
    if (!stay) return "";
    const p = findProperty(stay.propertyId);
    return `<h1>${esc(p?.label || p?.name || t("hero.newStay"))}</h1>
      <p>${niceDate(stay.arrival)} → ${niceDate(stay.departure)} · ${t("hero.guests", { n: stay.guests.length })}</p>${saved}`;
  }
  if (view.name === "settings") return `<h1>${t("settings.title")}</h1><p>${t("settings.subtitle")}</p>${saved}`;
  if (view.name === "help") return `<h1>${t("help.title")}</h1><p>${t("help.subtitle")}</p>`;
  const open = state.stays.filter(isOpen);
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
  layer.innerHTML = `<div class="toast ${flash.kind}" role="status">
    <span class="toast-icon">${flash.kind === "ok" ? ICON.check : "!"}</span><span class="toast-text" data-action="dismiss-flash">${esc(flash.text)}</span>
    ${flash.action ? `<button class="toast-action" data-action="toast-action">${esc(flash.action.label)}</button>` : ""}</div>`;
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
    }, flash.action ? 7000 : 3200);
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

// ---------------------------------------------------------------- sheets (in-app dialogs)

function openSheet(next) {
  sheet = next;
  renderSheet();
}

function closeSheet() {
  sheet = null;
  renderSheet();
}

function renderSheet() {
  const layer = document.getElementById("sheet-layer");
  if (sheet === shownSheet && layer.childElementCount === (sheet ? 2 : 0)) return;
  const opening = !shownSheet && sheet;
  shownSheet = sheet;
  if (!sheet) {
    layer.innerHTML = "";
    return;
  }
  const body = sheet.kind === "report" ? renderReportSheet() : sheet.kind === "lossy" ? renderLossySheet() : renderRestoreSheet();
  layer.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div>`;
  if (opening) layer.querySelector(".sheet input, .sheet button")?.focus({ preventScroll: true });
}

function renderReportSheet() {
  const stay = findStay(sheet.stayId);
  const fresh = stay.export && stay.export.fp === currentFp(stay);
  const fileNote = sheet.method === "file" && !fresh ? `<p class="sheet-warn">${t(stay.export ? "sheet.staleFile" : "sheet.noFile")}
      <button class="chip" data-action="export">${ICON.download}${t("report.download")}</button></p>` : "";
  return `<h2 id="sheet-title">${t("sheet.title.report")}</h2>
    <fieldset class="choice"><legend>${t("sheet.how")}</legend>
      ${["file", "form"].map((m) => `<label class="radio"><input type="radio" name="method" value="${m}" data-sheet-field="method" ${sheet.method === m ? "checked" : ""}>${t(m === "file" ? "sheet.viaFile" : "sheet.viaForm")}</label>`).join("")}
    </fieldset>
    ${fileNote}
    <label class="check"><input type="checkbox" data-sheet-field="checked" ${sheet.checked ? "checked" : ""}>${t("sheet.check", { n: stay.guests.length })}</label>
    <label>${t("sheet.ref")}<input data-sheet-field="ref" value="${esc(sheet.ref)}" autocomplete="off"></label>
    <div class="sheet-actions">
      <button data-action="close-sheet">${t("sheet.cancel")}</button>
      <button class="primary" data-action="confirm-report" ${sheet.checked ? "" : "disabled"}>${ICON.check}${t("sheet.confirm")}</button>
    </div>`;
}

function renderLossySheet() {
  return `<h2 id="sheet-title">${t("sheet.title.lossy")}</h2>
    <p>${esc(t("sheet.lossyText", { chars: sheet.chars.join(" ") }))}</p>
    <div class="sheet-actions">
      <button data-action="lossy-anyway">${t("sheet.lossyAnyway")}</button>
      <button class="primary" data-action="close-sheet">${t("sheet.lossyFix")}</button>
    </div>`;
}

function renderRestoreSheet() {
  const s = sheet.result.summary;
  return `<h2 id="sheet-title">${t("sheet.title.restore")}</h2>
    ${s.createdAt ? `<p class="muted">${t("restore.created", { date: esc(niceDateTime(s.createdAt)) })}</p>` : ""}
    <p><b>${t("restore.summary", { a: s.apartments, s: s.stays, g: s.guests })}</b></p>
    ${s.orphans ? `<p class="sheet-warn">${t("restore.orphans", { n: s.orphans })}</p>` : ""}
    <p class="muted">${t("restore.warning")}</p>
    <div class="sheet-actions">
      <button data-action="close-sheet">${t("sheet.cancel")}</button>
      <button class="primary" data-action="restore-confirm">${t("restore.confirm")}</button>
    </div>`;
}

// ---------------------------------------------------------------- views

function backupDue() {
  const s = state.settings;
  if (!state.stays.some((st) => st.guests.length)) return false;
  if (s.backupSnoozeUntil && Date.now() < Date.parse(s.backupSnoozeUntil)) return false;
  if (!s.lastBackupAt) return true;
  return Date.now() - Date.parse(s.lastBackupAt) > 14 * DAY || (s.changesSinceBackup || 0) >= 5;
}

function backupLine() {
  const at = state.settings.lastBackupAt;
  return at ? t("backup.last", { date: esc(niceDateTime(at)) }) : t("backup.lastNever");
}

function renderStays() {
  const needsProperty = !state.properties.length;
  const needsKey = !state.settings.apiKey;
  const stays = [...state.stays].sort((a, b) => (a.arrival || "9").localeCompare(b.arrival || "9"));
  const open = stays.filter(isOpen);
  const done = stays.filter((s) => !isOpen(s)).reverse();

  const card = (s) => {
    const stage = stageOf(s);
    const dl = deadlineInfo(s);
    const p = findProperty(s.propertyId);
    const bar = stage === "reported" ? "ok" : dl?.cls === "bad" ? "bad" : STAGE_CLASS[stage];
    return `<button class="stay-card s-${bar}" data-action="open-stay" data-id="${s.id}">
      <span class="stay-top"><span class="stay-place">${esc(p?.label || p?.name || t("stay.noProperty"))}</span>
        <span class="pills"><span class="pill ${STAGE_CLASS[stage]}">${t("stage." + stage)}</span>${dl ? `<span class="pill ${dl.cls}">${esc(dl.text)}</span>` : ""}</span></span>
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

  const reminder = backupDue()
    ? `<section class="card reminder"><h2>${ICON.shield}${t("backup.reminderTitle")}</h2>
        <p class="muted">${state.settings.lastBackupAt ? backupLine() + " " : ""}${t("backup.never")}</p>
        <div class="row-buttons"><button class="primary" data-action="backup">${t("backup.now")}</button><button data-action="backup-later">${t("backup.later")}</button></div>
      </section>`
    : "";

  const empty = !stays.length
    ? `<div class="empty"><div class="empty-art">${skylineSvg(3)}</div><h3>${t("list.emptyTitle")}</h3><p class="muted">${t("list.emptyText")}</p>
        <button class="primary" data-action="new-stay">${ICON.plus}${t("nav.newStay")}</button></div>`
    : "";

  const exportable = open.filter((s) => ["ready", "changed"].includes(stageOf(s)) && !stayIssues(s, findProperty(s.propertyId), today()).length);
  return `
    ${onboarding}
    ${reminder}
    ${empty}
    ${stays.length ? `<h2 class="section-title">${t("list.toReport")} ${open.length ? `<span class="count">${open.length}</span>` : ""}</h2>` : ""}
    ${stays.length && !open.length ? `<p class="all-done">${t("list.allDone")}</p>` : ""}
    <div class="stack">${open.map(card).join("")}</div>
    ${exportable.length > 1 ? `<button class="wide" data-action="export-all">${ICON.download}${t("list.exportAll")}</button>` : ""}
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
      <div data-status="report">${renderReport(stay)}</div>
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
  if (!stay.arrival || stageOf(stay) === "reported") return "";
  return `<p class="deadline">⏰ ${t("stay.deadline", { date: niceDate(reportDeadline(stay.arrival)) })}</p>`;
}

// Everything in the "Report to the police" card that depends on the current data.
function renderReport(stay) {
  const property = findProperty(stay.propertyId);
  const stage = stageOf(stay);
  const issues = stayIssues(stay, property, today());
  const apartmentWarnings = propertyIssues(property).filter((i) => i.level === "warn");
  const fresh = stay.export && stay.export.fp === currentFp(stay);
  const banner =
    stage === "changedAfterReport" ? `<p class="banner bad">${t("report.changedAfterReport")}</p>`
    : stage === "changed" && stay.export ? `<p class="banner warn">${t("report.changedSinceExport")}</p>` : "";
  const status = issues.length
    ? `<p class="still">${t("report.stillNeeded")}</p><ul class="errors">${issues.map((i) => `<li>${esc(t("s." + i.code, i.params || {}))}</li>`).join("")}</ul>`
    : `<p class="all-good"><svg viewBox="0 0 24 24" class="draw-check"><circle cx="12" cy="12" r="10"/><path d="m7 12.5 3.3 3.3L17 9"/></svg>${t("report.allGood")}</p>`;
  const apartment = apartmentWarnings.length
    ? `<p class="still">${t("report.apartmentWarnings")}</p><ul class="warnings">${apartmentWarnings.map((i) => `<li>${esc(t("pw." + i.code))}</li>`).join("")}</ul>` : "";
  const reported = stage === "reported" && stay.report
    ? `<p class="all-good">${ICON.check}${t("report.reportedOn", { date: esc(niceDateTime(stay.report.at)), method: t(stay.report.method === "form" ? "report.methodForm" : "report.methodFile") })}${stay.report.ref ? ` · ${esc(stay.report.ref)}` : ""}</p>
       <button data-action="reopen">↺ ${t("report.reopen")}</button>`
    : `<button class="success" data-action="open-report-sheet" ${issues.length ? "disabled" : ""}>${ICON.check}${t("report.confirm")}</button>`;
  return `${banner}${status}${apartment}
    <div class="rsteps">
      <div class="rstep"><span class="rnum">1</span><div>
        <button class="primary" data-action="export" ${issues.length ? "disabled" : ""}>${ICON.download}${t(stay.export && !fresh ? "report.downloadAgain" : "report.download")}</button>
        ${stay.export ? `<div class="muted small">${t("report.downloaded", { date: esc(niceDateTime(stay.export.at)) })}</div>` : ""}
      </div></div>
      <div class="rstep"><span class="rnum">2</span><div>${t("report.upload", { url: UBYPORT_URL })}</div></div>
      <div class="rstep"><span class="rnum">3</span><div>${stage === "reported" ? "" : t("report.receipt")} ${reported}</div></div>
    </div>`;
}

function renderGuestTitle(g, i) {
  const mrz = mrzState(g);
  const mrzBadge =
    mrz.state === "ok" ? `<span class="pill ok verified" title="${esc(t("guest.verifiedTitle"))}">${ICON.check}${t("guest.mrzOk")}</span>`
    : mrz.state === "failed" ? `<span class="pill bad">⚠ ${t("guest.mrzFailed")}</span>`
    : mrz.state === "edited" ? `<span class="pill warn">⚠ ${t("guest.mrzEdited")}</span>` : "";
  return `${avatar(g)}<span class="guest-name"><strong>${esc(guestName(g))}</strong>
    <span class="muted small">${g.nationality ? `${flag(g.nationality)} ${esc(countryName(g.nationality))}` : `#${i + 1}`}</span></span><span class="pills">${mrzBadge}</span>`;
}

function renderGuestStatus(stay, g) {
  const issues = guestIssues(g, stay, today());
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warn");
  const review = isReviewed(g)
    ? `<p class="reviewed">${ICON.check}${t("guest.reviewed")}</p>`
    : `<div class="review"><button class="success" data-action="review-guest" data-guest="${g.id}" ${errors.length ? "disabled" : ""}>${ICON.check}${t("guest.review")}</button>
        <span class="muted small">${t("guest.reviewHint")}</span></div>`;
  return (
    (errors.length ? `<ul class="errors">${errors.map((i) => `<li>${issueText(i)}</li>`).join("")}</ul>` : "") +
    (warnings.length ? `<ul class="warnings">${warnings.map((i) => `<li>${issueText(i)}</li>`).join("")}</ul>` : "") +
    review
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
  const hasErrors = guestIssues(g, stay, today()).some((x) => x.level === "error");
  const f = (field, label, attrs = "") =>
    `<label>${label}<input data-guest="${g.id}" data-field="${field}" value="${esc(g[field])}" ${attrs}></label>`;
  return `
  <div class="guest ${hasErrors ? "has-errors" : ""} ${freshGuests.has(g.id) ? "pop-in" : ""}" style="--i:${i}" data-guest-card="${g.id}">
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
      <p class="backup-status"><b>${backupLine()}</b><br><span class="muted small">${t(storageMode === "persisted" ? "backup.storagePersisted" : "backup.storageBestEffort")}</span></p>
      <div class="row-buttons">
        <button class="primary" data-action="backup">${ICON.shield}${t("backup.now")}</button>
        <label class="button-like">${t("set.restore")}<input type="file" accept="application/json,.json" data-action="restore" hidden></label>
      </div>
    </section>`;
}

function renderPropertySummary(p) {
  const issues = propertyIssues(p);
  const pill = issues.some((i) => i.level === "error") ? `<span class="pill bad">${t("set.idubMissing")}</span>`
    : issues.length ? `<span class="pill warn">${t("set.checkDetails")}</span>` : "";
  return `<strong>${esc(p.label || p.name || t("set.newApartment"))}</strong> ${p.idub ? `<span class="muted small">IDUB ${esc(p.idub)}</span>` : ""} ${pill}`;
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
// Replaces markup only when it changed, so a button about to be tapped isn't swapped out.
function setHtml(el, html) {
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function refreshStatus() {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  if (stay) {
    const set = (sel, html) => document.querySelectorAll(sel).forEach((el) => setHtml(el, html));
    set('[data-status="report"]', renderReport(stay));
    set('[data-status="deadline"]', renderDeadline(stay));
    set('[data-status="stepper"]', renderStepper(stay));
    setHtml(document.getElementById("hero-text"), renderHeroText());
    stay.guests.forEach((g, i) => {
      const card = document.querySelector(`[data-guest-card="${g.id}"]`);
      if (!card) return;
      card.classList.toggle("has-errors", guestIssues(g, stay, today()).some((x) => x.level === "error"));
      setHtml(card.querySelector('[data-status="guest-title"]'), renderGuestTitle(g, i));
      setHtml(card.querySelector('[data-status="guest"]'), renderGuestStatus(stay, g));
    });
  }
  document.querySelectorAll('[data-status="property"]').forEach((el) => {
    const p = findProperty(el.dataset.id);
    if (p) setHtml(el, renderPropertySummary(p));
  });
}

// ---------------------------------------------------------------- actions

function exportFiles(stays, { force = false } = {}) {
  const chars = [...new Set(stays.flatMap((s) => stayLossy(s, findProperty(s.propertyId))))];
  if (chars.length && !force) return openSheet({ kind: "lossy", stayIds: stays.map((s) => s.id), chars });
  const byProperty = new Map();
  for (const stay of stays) {
    if (!byProperty.has(stay.propertyId)) byProperty.set(stay.propertyId, []);
    byProperty.get(stay.propertyId).push(stay);
  }
  const now = new Date();
  for (const [propertyId, group] of byProperty) {
    const property = findProperty(propertyId);
    const entries = group.flatMap((stay) => stay.guests.map((guest) => ({ stay, guest })));
    download(unlFileName(property, now), encodeCp1250(buildUnl(property, entries, now)).bytes, "text/plain;charset=windows-1250");
    for (const s of group) s.export = { at: now.toISOString(), fp: stayFingerprint(s, property), method: "file", ref: "" };
  }
  noteChange();
  saveNow();
  // Downloading from inside the confirmation dialog refreshes its "file is out of date" note.
  if (sheet?.kind === "report") shownSheet = null;
  else sheet = null;
  showFlash("ok", t("toast.downloaded", { n: byProperty.size }));
}

async function backupNow() {
  const payload = JSON.stringify(backupPayload(state), null, 2);
  const name = `ubyport-helper-backup-${today()}.json`;
  const file = new File([payload], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
    else download(name, payload, "application/json");
  } catch (e) {
    if (e?.name === "AbortError") return;
    download(name, payload, "application/json");
  }
  Object.assign(state.settings, { lastBackupAt: new Date().toISOString(), changesSinceBackup: 0, backupSnoozeUntil: null });
  saveNow();
  showFlash("ok", t("backup.done"));
}

function replaceState(next) {
  state = next;
  saveNow();
  applyTheme(state.settings.theme);
  changeLanguage(state.settings.lang || getLang());
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
    noteChange();
    saveNow();
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
  shownSheet = undefined;
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
    case "toast-action": {
      const run = flash?.action?.run;
      flash = null;
      run?.();
      break;
    }
    case "close-sheet":
      closeSheet();
      return;
    case "new-stay": {
      const s = { id: uid(), propertyId: state.properties.length === 1 ? state.properties[0].id : "", arrival: today(), departure: "", label: "", guests: [], createdAt: new Date().toISOString(), export: null, report: null };
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
      noteChange();
      save();
      break;
    }
    case "review-guest": {
      const g = stay.guests.find((x) => x.id === el.dataset.guest);
      if (g && !guestIssues(g, stay, today()).some((i) => i.level === "error")) g.reviewedFp = guestFingerprint(g);
      save();
      refreshStatus();
      return;
    }
    case "remove-guest": {
      const g = stay.guests.find((x) => x.id === el.dataset.guest);
      if (!confirm(t("confirm.removeGuest", { name: guestName(g) }))) return;
      stay.guests = stay.guests.filter((x) => x.id !== g.id);
      noteChange();
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
    case "export": {
      const target = stay || findStay(sheet?.stayId);
      if (target && !stayIssues(target, findProperty(target.propertyId), today()).length) exportFiles([target]);
      return;
    }
    case "export-all":
      exportFiles(state.stays.filter((s) => ["ready", "changed"].includes(stageOf(s)) && !stayIssues(s, findProperty(s.propertyId), today()).length));
      return;
    case "lossy-anyway": {
      const stays = sheet.stayIds.map(findStay).filter(Boolean);
      sheet = null;
      exportFiles(stays, { force: true });
      return;
    }
    case "open-report-sheet":
      openSheet({ kind: "report", stayId: stay.id, method: "file", checked: false, ref: "" });
      return;
    case "confirm-report": {
      const target = findStay(sheet.stayId);
      if (!sheet.checked || !target) return;
      target.report = { at: new Date().toISOString(), fp: currentFp(target), method: sheet.method, ref: sheet.ref.trim() };
      noteChange();
      saveNow();
      sheet = null;
      view = { name: "stays" };
      flash = { kind: "ok", text: t("toast.reported") };
      confetti();
      break;
    }
    case "reopen":
      stay.report = null;
      saveNow();
      break;
    case "delete-stay":
      if (!confirm(t("confirm.deleteStay"))) return;
      state.stays = state.stays.filter((s) => s.id !== stay.id);
      noteChange();
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
      noteChange();
      save();
      break;
    case "remove-property": {
      const used = state.stays.some((s) => s.propertyId === el.dataset.id);
      if (!confirm(t(used ? "confirm.removeUsedApartment" : "confirm.removeApartment"))) return;
      state.properties = state.properties.filter((p) => p.id !== el.dataset.id);
      noteChange();
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
      backupNow();
      return;
    case "backup-later":
      state.settings.backupSnoozeUntil = new Date(Date.now() + 3 * DAY).toISOString();
      save();
      break;
    case "restore-confirm": {
      const previous = JSON.stringify(state);
      try {
        localStorage.setItem(BEFORE_RESTORE_KEY, previous);
      } catch {}
      const data = sheet.result.data;
      sheet = null;
      replaceState({ ...data, settings: { ...data.settings, apiKey: state.settings.apiKey } });
      view = { name: "stays" };
      showFlash("ok", t("toast.restored"), {
        label: t("toast.undo"),
        run: () => {
          replaceState(JSON.parse(previous));
          showFlash("ok", t("toast.restoreUndone"));
        },
      });
      return;
    }
    default:
      return;
  }
  render();
});

// Typing updates state and the status messages, never the inputs themselves.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.sheetField && sheet) {
    sheet[el.dataset.sheetField] = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.sheetField === "method") {
      shownSheet = null;
      renderSheet();
    } else document.querySelector('[data-action="confirm-report"]')?.toggleAttribute("disabled", !sheet.checked);
    return;
  }
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
    el.value = "";
    if (!file) return;
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return showFlash("error", t("toast.notBackup"));
    }
    const result = validateBackup(raw);
    if (!result.ok) return showFlash("error", t(result.error === "notBackup" ? "toast.notBackup" : `restore.${result.error}`));
    openSheet({ kind: "restore", result });
    return;
  }
  if (el.dataset.sheetField) return;
  // Selects and some date pickers only fire "change"; text fields were already recorded while typing.
  if (el.tagName === "SELECT" || el.type === "date") el.dispatchEvent(new Event("input", { bubbles: true }));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet) closeSheet();
});

setLang(state.settings.lang || DEFAULT_LANG);
applyTheme(state.settings.theme);
mountShell();
render();
requestPersistence().then((mode) => {
  storageMode = mode;
  if (view.name === "settings") render();
});
