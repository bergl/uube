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
const LANG_NAMES = { en: "English", cs: "Čeština", ru: "Русский" };
const COMMON_COUNTRIES = ["DEU", "GBR", "USA", "POL", "SVK", "UKR", "FRA", "ITA", "ESP", "NLD", "AUT", "ISR", "KOR", "CHN", "CAN", "AUS"];
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
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4v4h-4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 5.5 6.5 6.5L9 18.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
};

// ---------------------------------------------------------------- state

const emptyProperty = (hue) => ({
  id: uid(), label: "", idub: "", abbr: "", name: "", contact: "", district: "Praha",
  municipality: "Praha", municipalityPart: "", street: "", houseNumber: "", orientationNumber: "", zip: "", hue,
});

const emptyGuest = () => ({
  id: uid(), surname: "", givenNames: "", birthDate: "", sex: "", nationality: "", documentType: "passport",
  documentNumber: "", issuingCountry: "", expiryDate: "", visa: "", address: "", purpose: "10", note: "",
  mrz: null, mrzLines: [], readerProblems: "", reviewedFp: "",
});

let state = load();
let view = parseRoute();
let flash = null; // { kind, text, action?: { label, run } }
let sheet = null; // in-app dialog, see renderSheet()
let tray = null; // photos picked but not sent yet: { stayId, items: [{ id, file, url, rotation }] }
let reading = null; // photos being read: { stayId, phase, i, n, batch, batches, sentAt, controller }
let lastViewKey = null;
let shownFlash = null;
let shownSheet = null;
let toastTimer = null;
let progressTimer = null;
let saveStatus = "saved";
let storageMode = "unsupported";
let pointerDown = false;
let refreshPending = false;
let stayRefreshTimer = null;
let activeTab = null; // tab the highlight currently sits on
const sectionOpen = new Map(); // "stayId:details" / "stayId:guests" → open?
const freshGuests = new Set();
const photos = new Map(); // guest id → [{ url, rotation }], kept in memory only
const expanded = new Set(); // guest ids open for editing
const touched = new Set(); // "guestId:field" — errors show once a field has been visited
const showAll = new Set(); // stay or guest ids whose errors are all shown (after an export or review attempt)
const scrollMemory = {};

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

// ---------------------------------------------------------------- routing

function parseRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, "").split("/");
  if (name === "stay" && id) return { name: "stay", id };
  if (name === "settings" || name === "help") return { name };
  return { name: "stays" };
}

const viewKey = (v) => v.name + (v.id || "");

// In-app navigation updates the view right away; Back and Forward arrive as popstate.
function go(name, id) {
  const hash = name === "stays" ? "#/" : `#/${name}${id ? "/" + id : ""}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  applyRoute();
}

function applyRoute() {
  let next = parseRoute();
  if (next.name === "stay" && !findStay(next.id)) {
    history.replaceState(null, "", "#/");
    next = { name: "stays" };
  }
  scrollMemory[viewKey(view)] = scrollY;
  if (view.name === "stay" && viewKey(next) !== viewKey(view)) dropIfEmpty(view.id);
  if (next.name === "stay" && viewKey(next) !== viewKey(view)) foldCompleteSections(findStay(next.id));
  view = next;
  render();
}

// A stay opened with + and left untouched isn't kept.
function dropIfEmpty(id) {
  const s = findStay(id);
  if (!s || s.guests.length || s.label || s.departure || s.export || s.report || (tray?.stayId === id) || (reading?.stayId === id)) return;
  state.stays = state.stays.filter((x) => x !== s);
  save();
}

// ---------------------------------------------------------------- helpers

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

const firstName = (g) => (g.givenNames || "").split(" ")[0] || g.surname || t("guest.unnamed");

function countryName(code, lang = getLang()) {
  return COUNTRY_INFO[code]?.[lang] || COUNTRIES[code] || code;
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

const propertyHue = (p) => (Number.isFinite(p?.hue) ? p.hue : (state.properties.indexOf(p) * 67 + 15) % 360);
const aptDot = (p) => (p ? `<span class="apt-dot" style="--h:${propertyHue(p)}" aria-hidden="true"></span>` : "");

function showFlash(kind, text, action, detail) {
  flash = { kind, text, action, detail };
  render();
}

function undoable(text, undo) {
  showFlash("ok", text, { label: t("toast.undo"), run: undo });
}

function greeting() {
  const h = new Date().getHours();
  return t(h < 5 ? "greet.night" : h < 11 ? "greet.morning" : h < 18 ? "greet.day" : h < 23 ? "greet.evening" : "greet.night");
}

const FIELD_LABEL = {
  surname: "f.surname", givenNames: "f.givenNames", birthDate: "f.birthDate", nationality: "f.nationality",
  documentNumber: "f.documentNumber", visa: "f.visa", address: "f.address", purpose: "f.purpose", note: "f.note",
};
const GUEST_INPUTS = ["surname", "givenNames", "birthDate", "nationality", "documentNumber", "visa", "address", "purpose", "note"];

const issuesOf = (stay, g) => guestIssues(g, stay, today());
const hasErrors = (stay, g) => issuesOf(stay, g).some((i) => i.level === "error");
const guestReady = (stay, g) => !hasErrors(stay, g) && isReviewed(g);
const errorsVisible = (stay, g, field) => showAll.has(stay.id) || showAll.has(g.id) || touched.has(`${g.id}:${field}`);
const isBlank = (g) => !g.surname && !g.givenNames && !g.documentNumber && !g.birthDate;

const stageOf = (stay) => stayStage(stay, findProperty(stay.propertyId), today());
const isOpen = (stay) => stageOf(stay) !== "reported";
const currentFp = (stay) => {
  const p = findProperty(stay.propertyId);
  return p ? stayFingerprint(stay, p) : "";
};

const DETAIL_CODES = ["chooseProperty", "noIdub", "dates", "datesInvalid", "datesOrder"];

function sectionComplete(stay, section) {
  if (section === "details") return !stayIssues(stay, findProperty(stay.propertyId), today()).some((i) => DETAIL_CODES.includes(i.code));
  return stay.guests.length > 0 && stay.guests.every((g) => guestReady(stay, g));
}

const isSectionOpen = (stay, section) => sectionOpen.get(`${stay.id}:${section}`) ?? !sectionComplete(stay, section);

function setSectionOpen(stay, section, open) {
  sectionOpen.set(`${stay.id}:${section}`, open);
}

// Finished sections fold into a one-line summary when a stay is opened; they never fold while being edited.
function foldCompleteSections(stay) {
  if (!stay) return;
  for (const section of ["details", "guests"]) setSectionOpen(stay, section, !sectionComplete(stay, section));
}

// Opens the section that contains an element before jumping to it.
function revealSection(stay, el) {
  const section = el?.closest?.("#sec-details") ? "details" : el?.closest?.("#sec-guests") ? "guests" : null;
  if (!stay || !section || isSectionOpen(stay, section)) return false;
  setSectionOpen(stay, section, true);
  render();
  return true;
}

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

// Moves focus to a field and keeps it clear of the floating tab bar.
function focusField(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
}

// ---------------------------------------------------------------- layout

function mountShell() {
  document.getElementById("app").innerHTML = `
    <header class="hero">
      ${skylineSvg()}
      <div class="hero-head">
        <div class="hero-tools">
          <button class="hero-btn" data-action="open-lang" aria-label="${esc(t("nav.language"))}">${ICON.globe}<span id="lang-label"></span></button>
          <button class="hero-btn" data-action="nav" data-view="help" aria-label="${esc(t("nav.help"))}">${ICON.help}</button>
        </div>
        <div class="hero-text" id="hero-text"></div>
      </div>
    </header>
    <div id="toast-layer" aria-live="polite"></div>
    <main id="view"></main>
    <nav class="tabbar settling" id="tabbar"><span class="tab-indicator hidden" aria-hidden="true"></span>${renderTabbar()}</nav>
    <div id="sheet-layer"></div>
    <input type="file" id="photo-input" accept="image/*" multiple data-action="photos" class="visually-hidden" tabindex="-1" aria-hidden="true">
    <input type="file" id="restore-input" accept="application/json,.json" data-action="restore" class="visually-hidden" tabindex="-1" aria-hidden="true">`;
  watchHero();
  activeTab = null;
}

// Pauses the skyline's animations while the header is scrolled out of view.
function watchHero() {
  const hero = document.querySelector(".hero");
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => hero.classList.toggle("paused", !entry.isIntersecting)).observe(hero);
}

function render() {
  const key = viewKey(view);
  const main = document.getElementById("view");
  const heroText = document.getElementById("hero-text");
  main.innerHTML =
    view.name === "stay" ? renderStay(findStay(view.id)) : view.name === "settings" ? renderSettings() : view.name === "help" ? renderHelp() : renderStays();
  document.querySelector(".hero").classList.toggle("compact", view.name !== "stays");
  heroText.innerHTML = renderHeroText();
  document.getElementById("lang-label").textContent = LANGS[getLang()];
  updateTabbar();

  if (key !== lastViewKey) {
    const firstRender = lastViewKey === null;
    lastViewKey = key;
    window.scrollTo(0, scrollMemory[key] || 0);
    for (const el of [main, heroText]) {
      el.classList.remove("enter");
      void el.offsetWidth;
      el.classList.add("enter");
    }
    clearTimeout(render.enterTimer);
    render.enterTimer = setTimeout(() => [main, heroText].forEach((el) => el.classList.remove("enter")), 900);
    if (!firstRender) heroText.querySelector("h1")?.focus({ preventScroll: true });
  }
  renderToast();
  renderSheet();
  freshGuests.clear();
  syncProgressTimer();
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
    return `<h1 tabindex="-1">${esc(p?.label || p?.name || t("hero.newStay"))}</h1>
      <p>${niceDate(stay.arrival)} → ${niceDate(stay.departure)} · ${t("hero.guests", { n: stay.guests.length })}</p>${saved}`;
  }
  if (view.name === "settings") return `<h1 tabindex="-1">${t("settings.title")}</h1><p>${t("settings.subtitle")}</p>${saved}`;
  if (view.name === "help") return `<h1 tabindex="-1">${t("help.title")}</h1><p>${t("help.subtitle")}</p>`;
  const open = state.stays.filter(isOpen);
  let line;
  if (!state.properties.length) line = t("hero.setup");
  else if (!open.length) line = t("hero.allDone");
  else {
    const next = open.map((s) => (s.arrival ? reportDeadline(s.arrival) : null)).filter(Boolean).sort()[0];
    line = t("hero.toReport", { n: open.length }) + (next ? ` · ${t("hero.nextDue", { date: niceDate(next) })}` : "");
  }
  return `<h1 tabindex="-1">${greeting()}&nbsp;<span class="wave">👋</span></h1><p>${esc(line)}</p>`;
}

// The tab bar is built once per language; navigation only moves its highlight.
function renderTabbar() {
  return `
    <button class="tab" data-action="nav" data-view="stays">${ICON.home}<span>${t("nav.stays")}</span></button>
    <button class="fab-wrap" data-action="new-stay"><span class="fab">${ICON.plus}</span><span class="fab-label">${t("nav.newStay")}</span></button>
    <button class="tab" data-action="nav" data-view="settings">${ICON.cog}<span>${t("nav.settings")}</span></button>`;
}

function placeIndicator(bar, tab) {
  const indicator = bar.querySelector(".tab-indicator");
  indicator.classList.toggle("hidden", !tab);
  if (!tab) return;
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
}

function updateTabbar() {
  const bar = document.getElementById("tabbar");
  const name = view.name === "stay" ? "stays" : view.name;
  let active = null;
  for (const tab of bar.querySelectorAll(".tab")) {
    const on = tab.dataset.view === name;
    tab.classList.toggle("on", on);
    if (on) active = tab;
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  const moved = active && activeTab && active !== activeTab;
  placeIndicator(bar, active);
  if (moved && !reducedMotion) {
    // A little stretch while the highlight travels, and a bounce of the icon it lands on.
    bar.querySelector(".tab-indicator").animate([{ scale: "1 1" }, { scale: "1.22 .84" }, { scale: "1 1" }], { duration: 500, easing: "ease-out" });
    active.querySelector("svg").animate([{ transform: "none" }, { transform: "translateY(-3px) scale(1.2)" }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }
  if (active || !activeTab) activeTab = active;
  if (bar.classList.contains("settling")) requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove("settling")));
}

// Like iOS: the bar gets smaller while scrolling down and comes back when scrolling up or at either end.
function watchScroll() {
  let lastY = scrollY;
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const bar = document.getElementById("tabbar");
      const y = scrollY;
      const atEnd = innerHeight + y >= document.documentElement.scrollHeight - 48;
      if (y < 80 || atEnd || y < lastY - 10) bar?.classList.remove("minimized");
      else if (y > lastY + 10) bar?.classList.add("minimized");
      if (Math.abs(y - lastY) > 10) lastY = y;
    });
  }, { passive: true });
  addEventListener("resize", () => {
    const bar = document.getElementById("tabbar");
    bar.classList.add("settling");
    placeIndicator(bar, bar.querySelector(".tab.on"));
    requestAnimationFrame(() => bar.classList.remove("settling"));
  });
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
  layer.innerHTML = `<div class="toast ${flash.kind}" role="${flash.kind === "error" ? "alert" : "status"}">
    <span class="toast-icon">${flash.kind === "ok" ? ICON.check : "!"}</span>
    <div class="toast-body"><span class="toast-text">${esc(flash.text)}</span>
      ${flash.detail ? `<details class="toast-detail"><summary>${t("toast.details")}</summary><code>${esc(flash.detail)}</code></details>` : ""}</div>
    ${flash.action ? `<button class="toast-action" data-action="toast-action">${esc(flash.action.label)}</button>` : ""}
    <button class="toast-close" data-action="dismiss-flash" aria-label="${esc(t("toast.close"))}">${ICON.close}</button></div>`;
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

// ---------------------------------------------------------------- sheets (in-app dialogs)

function openSheet(next) {
  sheet = next;
  shownSheet = null;
  renderSheet();
}

function closeSheet() {
  const was = sheet;
  sheet = null;
  renderSheet();
  if (was?.kind === "country") {
    touched.add(`${was.guestId}:nationality`);
    refreshStatus();
    document.getElementById(`in-${was.guestId}-nationality`)?.focus({ preventScroll: true });
  }
}

function renderSheet() {
  const layer = document.getElementById("sheet-layer");
  if (sheet === shownSheet && layer.childElementCount === (sheet ? 2 : 0)) return;
  const opening = !layer.childElementCount && sheet;
  shownSheet = sheet;
  if (!sheet) {
    layer.innerHTML = "";
    return;
  }
  const renderers = { preview: renderPreviewSheet, report: renderReportSheet, lossy: renderLossySheet, restore: renderRestoreSheet, lang: renderLangSheet, apikey: renderKeySheet, country: renderCountrySheet, photo: renderPhotoSheet };
  layer.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet sheet-${sheet.kind}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${renderers[sheet.kind]()}</div>`;
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
    <label for="sheet-ref">${t("sheet.ref")}</label><input id="sheet-ref" data-sheet-field="ref" value="${esc(sheet.ref)}" autocomplete="off">
    <div class="sheet-actions">
      <button data-action="close-sheet">${t("sheet.cancel")}</button>
      <button class="primary" data-action="confirm-report" ${sheet.checked ? "" : "disabled"}>${ICON.check}${t("sheet.confirm")}</button>
    </div>`;
}

// Shows exactly what the downloaded file would contain, as Ubyport will read it.
function renderPreviewSheet() {
  const stay = findStay(sheet.stayId);
  const property = findProperty(stay.propertyId);
  if (!property) return `<h2 id="sheet-title">${t("preview.title")}</h2><p class="sheet-warn">${t("s.chooseProperty")}</p>
    <div class="sheet-actions"><button class="primary" data-action="close-sheet">${t("photo.close")}</button></div>`;
  const now = new Date();
  const sent = new TextDecoder("windows-1250").decode(encodeCp1250(buildUnl(property, stay.guests.map((guest) => ({ stay, guest })), now)).bytes);
  const lines = sent.split("\r\n");
  const complete = !stayIssues(stay, property, today()).length;
  const value = (v) => (v ? esc(v) : `<span class="muted">—</span>`);
  const rows = (pairs) => `<dl class="kv">${pairs.map(([label, v]) => `<dt>${label}</dt><dd>${value(v)}</dd>`).join("")}</dl>`;
  const head = lines[0].split("|");
  const headerCard = `<div class="preview-card"><p class="preview-head">${aptDot(property)}${t("preview.header")}</p>${rows([
    [t("p.idub"), head[2]], [t("p.abbr"), head[3]], [t("p.name"), head[4]], [t("p.contact"), head[5]], [t("p.district"), head[6]],
    [t("p.municipality"), head[7]], [t("p.municipalityPart"), head[8]], [t("p.street"), head[9]], [t("p.houseNumber"), head[10]],
    [t("p.orientationNumber"), head[11]], [t("p.zip"), head[12]], [t("preview.created"), head[13]],
  ])}</div>`;
  const guestCards = lines.slice(1).map((line, i) => {
    const f = line.split("|");
    return `<div class="preview-card"><p class="preview-head">${avatar(stay.guests[i])}${value([f[4], f[3]].filter(Boolean).join(" "))}</p>${rows([
      [t("stay.arrival"), f[1]], [t("stay.departure"), f[2]], [t("f.surname"), f[3]], [t("f.givenNames"), f[4]], [t("f.birthDate"), f[6]],
      [t("f.nationality"), f[9] && `${f[9]} · ${countryName(f[9])}`], [t("f.address"), f[10]], [t("f.documentNumber"), f[11]], [t("f.visa"), f[12]],
      [t("f.purpose"), f[13] && `${f[13]} · ${t("purpose." + f[13])}`], [t("f.note"), f[15]],
    ])}</div>`;
  }).join("");
  const raw = `<pre class="unl-raw" tabindex="0">${lines.map((l) => esc(l).replace(/\|/g, '<span class="sep">|</span>')).join("\n")}</pre>`;
  return `<h2 id="sheet-title">${t("preview.title")}</h2>
    <p class="muted small">${esc(unlFileName(property, now))} · Windows-1250</p>
    ${complete ? "" : `<p class="sheet-warn">${t("preview.incomplete")}</p>`}
    <div class="segmented two-way">${["readable", "raw"].map((m) => `<button class="${sheet.mode === m ? "on" : ""}" data-action="preview-mode" data-mode="${m}" aria-pressed="${sheet.mode === m}">${t("preview." + m)}</button>`).join("")}</div>
    <div class="preview-body" tabindex="0" role="region" aria-label="${t("preview." + sheet.mode)}">${sheet.mode === "raw" ? raw : guestCards + headerCard}</div>
    <div class="sheet-actions preview-actions">
      <button data-action="close-sheet">${t("photo.close")}</button>
      ${complete ? `<button class="primary" data-action="export">${ICON.download}${t("report.download")}</button>` : ""}
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

function renderLangSheet() {
  return `<h2 id="sheet-title">${t("set.language")}</h2>
    <div class="option-list">${Object.keys(LANGS)
      .map((code) => `<button class="option ${getLang() === code ? "on" : ""}" data-action="set-lang" data-lang="${code}" aria-pressed="${getLang() === code}">
        <span>${LANG_NAMES[code]}</span>${getLang() === code ? ICON.check : ""}</button>`)
      .join("")}</div>`;
}

function renderKeySheet() {
  return `<h2 id="sheet-title">${t("set.reading")}</h2>
    <p class="muted">${t("key.text")}</p>
    <label for="sheet-key">${t("set.apiKey")}</label>
    <input id="sheet-key" type="password" data-sheet-field="key" value="${esc(sheet.key || "")}" placeholder="sk-ant-…" autocomplete="off">
    <div class="sheet-actions">
      <button data-action="key-manual">${t("key.manual")}</button>
      <button class="primary" data-action="save-key">${ICON.camera}${t("key.save")}</button>
    </div>`;
}

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function countryOptions(query) {
  const button = (code) => `<button class="option" data-action="choose-country" data-code="${code}"><span>${flag(code)} ${esc(countryName(code))}</span><span class="muted small">${code}</span></button>`;
  const q = fold(query.trim());
  const lang = getLang();
  const all = Object.keys(COUNTRIES).sort((a, b) => countryName(a).localeCompare(countryName(b), lang));
  if (!q) {
    return `<p class="option-head">${t("country.common")}</p>${COMMON_COUNTRIES.map(button).join("")}
      <p class="option-head">${t("country.all")}</p>${all.map(button).join("")}`;
  }
  const matches = all.filter((code) => [code, countryName(code, "en"), countryName(code, "cs"), countryName(code, "ru")].some((n) => fold(n).includes(q)));
  return matches.length ? matches.map(button).join("") : `<p class="muted">${t("country.none")}</p>`;
}

function renderCountrySheet() {
  return `<h2 id="sheet-title">${t("f.nationality")}</h2>
    <input type="search" data-sheet-field="query" value="${esc(sheet.query)}" placeholder="${esc(t("country.search"))}" aria-label="${esc(t("country.search"))}" autocomplete="off">
    <div class="option-list scroll" data-status="country-list">${countryOptions(sheet.query)}</div>`;
}

function renderPhotoSheet() {
  return `<h2 id="sheet-title" class="visually-hidden">${t("guest.photo", { n: sheet.k + 1 })}</h2>
    <div class="viewer ${sheet.zoom ? "zoomed" : ""}">
      <img src="${sheet.url}" style="--rot:${sheet.rotation * 90}deg" alt="${esc(t("guest.photo", { n: sheet.k + 1 }))}" data-action="toggle-zoom" title="${esc(t("photo.zoom"))}">
    </div>
    <div class="sheet-actions"><button class="primary" data-action="close-sheet">${t("photo.close")}</button></div>`;
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
  const stays = [...state.stays].sort((a, b) => (a.arrival || "9").localeCompare(b.arrival || "9"));
  const open = stays.filter(isOpen);
  const done = stays.filter((s) => !isOpen(s)).reverse();

  const card = (s) => {
    const stage = stageOf(s);
    const dl = deadlineInfo(s);
    const p = findProperty(s.propertyId);
    const bar = stage === "reported" ? "ok" : dl?.cls === "bad" ? "bad" : STAGE_CLASS[stage];
    return `<button class="stay-card s-${bar}" data-action="open-stay" data-id="${s.id}">
      <span class="stay-top"><span class="stay-place">${aptDot(p)}${esc(p?.label || p?.name || t("stay.noProperty"))}</span>
        <span class="pills"><span class="pill ${STAGE_CLASS[stage]}">${t("stage." + stage)}</span>${dl ? `<span class="pill ${dl.cls}">${esc(dl.text)}</span>` : ""}</span></span>
      <span class="stay-dates">${niceDate(s.arrival)} <span class="arrow">→</span> ${s.departure ? niceDate(s.departure) : `<span class="pill muted">${t("stay.addDeparture")}</span>`}${s.label ? ` · <span class="muted">${esc(s.label)}</span>` : ""}</span>
      <span class="stay-bottom">${s.guests.length
        ? `<span class="avatars">${s.guests.slice(0, 5).map(avatar).join("")}</span><span class="muted small">${t("hero.guests", { n: s.guests.length })}</span>`
        : `<span class="pill muted">${t("stay.noGuestsYet")}</span>`}<span class="chev">${ICON.chevron}</span></span>
    </button>`;
  };

  const onboarding = !state.properties.length
    ? `<section class="card onboarding">
        <h2>${t("onb.title")}</h2><p class="muted">${t("onb.text")}</p>
        <ol class="checklist">
          <li><button data-action="nav" data-view="settings"><span class="tick">1</span>${t("onb.property")}</button></li>
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
  const steps = [["step.details", "sec-details"], ["step.guests", "sec-guests"], ["step.file", "sec-report"], ["step.reported", "sec-report"]];
  return `<ol class="stepper">${steps
    .map(([label, target], i) => `<li class="${done[i] ? "done" : ""} ${current === i ? "current" : ""}">
      <button data-action="jump-section" data-target="${target}" ${current === i ? 'aria-current="step"' : ""}><span class="dot">${done[i] ? ICON.check : i + 1}</span><span class="lbl">${t(label)}</span></button></li>`)
    .join("")}</ol>`;
}

function renderStay(stay) {
  if (!stay) return `<p>—</p>`;
  return `
    <button class="back" data-action="nav" data-view="stays">${ICON.back}${t("nav.stays")}</button>
    <div data-status="stepper">${renderStepper(stay)}</div>

    <section class="card section ${isSectionOpen(stay, "details") ? "" : "collapsed"}" id="sec-details">
      <h2 tabindex="-1" data-status="head-details">${renderSectionHead(stay, "details")}</h2>
      <div class="section-body" id="secbody-details" ${isSectionOpen(stay, "details") ? "" : "hidden"}>
      <label for="in-property">${t("stay.apartment")}</label>
      <select id="in-property" data-stay-field="propertyId">
        <option value="">${t("stay.choose")}</option>
        ${state.properties.map((p) => `<option value="${p.id}" ${p.id === stay.propertyId ? "selected" : ""}>${esc(p.label || p.name || "—")}</option>`).join("")}
      </select>
      ${state.properties.length ? "" : `<p class="hint"><button class="link" data-action="nav" data-view="settings">${t("stay.noApartments")}</button></p>`}
      <div class="two">
        <div><label for="in-arrival">${t("stay.arrival")}</label><input type="date" id="in-arrival" data-stay-field="arrival" value="${esc(stay.arrival)}"></div>
        <div><label for="in-departure">${t("stay.departure")}</label><input type="date" id="in-departure" data-stay-field="departure" value="${esc(stay.departure)}"></div>
      </div>
      <div class="nights"><span class="muted small">${t("stay.nightsLabel")}</span>${[1, 2, 3, 7]
        .map((n) => `<button class="chip" data-action="set-nights" data-n="${n}" aria-label="${esc(t("stay.nights", { n }))}">${n}</button>`).join("")}</div>
      <div data-status="deadline">${renderDeadline(stay)}</div>
      <label for="in-label">${t("stay.note")}</label>
      <input id="in-label" data-stay-field="label" value="${esc(stay.label)}" placeholder="${esc(t("stay.notePlaceholder"))}">
      </div>
    </section>

    <section class="card section ${isSectionOpen(stay, "guests") ? "" : "collapsed"}" id="sec-guests">
      <h2 tabindex="-1" data-status="head-guests">${renderSectionHead(stay, "guests")}</h2>
      <div class="section-body" id="secbody-guests" ${isSectionOpen(stay, "guests") ? "" : "hidden"}>
      <div class="ask">
        <span class="muted small">${ICON.chat}${t("stay.askGuest")}</span>
        <span class="chips">${Object.entries(LANGS).map(([code, label]) => `<button class="chip" data-action="copy-guest-message" data-lang="${code}">${label}</button>`).join("")}</span>
      </div>
      <div data-status="photo-area">${renderPhotoArea(stay)}</div>
      <div data-status="guest-summary">${renderGuestSummary(stay)}</div>
      <div class="guest-list">${stay.guests.map((g, i) => renderGuest(stay, g, i)).join("")}</div>
      </div>
    </section>

    <section class="card" id="sec-report">
      <h2 id="report-title" tabindex="-1"><span class="num">3</span>${t("report.title")}</h2>
      <div data-status="report">${renderReport(stay)}</div>
      <details><summary>${t("report.manual")}</summary>${renderManualCopy(stay)}</details>
    </section>
    <button class="danger" data-action="delete-stay">${t("stay.delete")}</button>`;
}

function renderSectionHead(stay, section) {
  const open = isSectionOpen(stay, section);
  const done = sectionComplete(stay, section);
  const number = section === "details" ? 1 : 2;
  let summary = "";
  if (section === "details") {
    const p = findProperty(stay.propertyId);
    const nights = stay.arrival && stay.departure ? daysBetween(stay.arrival, stay.departure) : 0;
    summary = `${aptDot(p)}${esc(p?.label || p?.name || "")} · ${niceDate(stay.arrival)} → ${niceDate(stay.departure)}${nights > 0 ? ` · ${t("stay.nights", { n: nights })}` : ""}${stay.label ? ` · ${esc(stay.label)}` : ""}`;
  } else {
    summary = `<span class="avatars">${stay.guests.slice(0, 4).map(avatar).join("")}</span>${t("hero.guests", { n: stay.guests.length })}${done ? ` · ${t("guests.allReviewed")}` : ""}`;
  }
  return `<button class="section-toggle" data-action="toggle-section" data-section="${section}" aria-expanded="${open}" aria-controls="secbody-${section}">
    <span class="num ${done ? "done" : ""}">${done ? ICON.check : number}</span>
    <span class="section-name"><span class="section-label">${t(section === "details" ? "stay.details" : "stay.guests")}</span>
      <span class="section-summary">${summary}</span></span>
    <span class="chev">${ICON.chevron}</span></button>`;
}

function passportArt() {
  return `<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="2" width="60" height="40" rx="5" class="pp-body"/>
    <rect x="8" y="8" width="14" height="18" rx="2" class="pp-photo"/><rect x="27" y="9" width="28" height="3" rx="1.5" class="pp-line"/>
    <rect x="27" y="16" width="20" height="3" rx="1.5" class="pp-line"/><rect x="27" y="23" width="24" height="3" rx="1.5" class="pp-line"/>
    <rect x="8" y="32" width="48" height="2.4" rx="1.2" class="pp-mrz"/><rect x="8" y="36.5" width="48" height="2.4" rx="1.2" class="pp-mrz"/></svg>`;
}

function renderPhotoArea(stay) {
  if (reading?.stayId === stay.id) {
    return `<div class="scanner" role="status">
      <div class="scan-doc">${passportArt()}<span class="beam"></span></div>
      <div class="scan-text" id="progress-text">${progressText()}</div>
      ${reading.batches > 1 ? `<small class="muted">${t("progress.batch", { i: reading.batch, n: reading.batches })}</small>` : ""}
      <button data-action="cancel-reading">${t("sheet.cancel")}</button>
    </div>`;
  }
  if (tray?.stayId === stay.id) {
    return `<div class="tray">
      <p class="muted small">${t("tray.hint")}</p>
      <div class="tray-grid">${tray.items
        .map((it, k) => `<figure class="tray-item">
          <img src="${it.url}" style="--rot:${it.rotation * 90}deg" alt="${esc(t("guest.photo", { n: k + 1 }))}">
          <div class="tray-tools">
            <button data-action="tray-rotate" data-id="${it.id}" aria-label="${esc(t("tray.rotate"))}">${ICON.rotate}</button>
            <button data-action="tray-remove" data-id="${it.id}" aria-label="${esc(t("tray.remove"))}">${ICON.close}</button>
          </div></figure>`)
        .join("")}
        <button class="tray-add" data-action="pick-photos">${t("tray.add")}</button>
      </div>
      <div class="row-buttons end">
        <button data-action="tray-cancel">${t("sheet.cancel")}</button>
        <button class="primary" data-action="tray-read" ${tray.items.length ? "" : "disabled"}>${ICON.camera}${t("tray.read", { n: tray.items.length })}</button>
      </div>
    </div>`;
  }
  return `<div class="add-guests">
      <button class="add-btn main" data-action="pick-photos">${ICON.camera}<span>${t("upload.photos")}</span></button>
      <button class="add-btn" data-action="add-guest">${ICON.pen}<span>${t("upload.manual")}</span></button>
    </div>
    <p class="privacy muted small">${ICON.lock}<span>${t("upload.privacy")} ${t("upload.paste")}</span></p>`;
}

function progressText() {
  if (!reading) return "";
  if (reading.phase === "prepare") return t("progress.prepare", { i: reading.i, n: reading.n });
  if (reading.phase === "check") return t("progress.check");
  if (reading.phase === "send" && reading.sentAt) return t("progress.wait", { s: Math.floor((Date.now() - reading.sentAt) / 1000) });
  return t("progress.send");
}

function syncProgressTimer() {
  if (!reading) {
    clearInterval(progressTimer);
    progressTimer = null;
    return;
  }
  if (!progressTimer) progressTimer = setInterval(updateProgress, 1000);
}

function updateProgress() {
  const el = document.getElementById("progress-text");
  if (el) el.textContent = progressText();
}

function renderDeadline(stay) {
  if (!stay.arrival || stageOf(stay) === "reported") return "";
  return `<p class="deadline">⏰ ${t("stay.deadline", { date: niceDate(reportDeadline(stay.arrival)) })}</p>`;
}

function renderGuestSummary(stay) {
  const n = stay.guests.length;
  if (!n) return "";
  const ready = stay.guests.filter((g) => guestReady(stay, g)).length;
  const next = stay.guests.find((g) => !guestReady(stay, g));
  const withAddress = stay.guests.find((g) => g.address.trim());
  const without = stay.guests.filter((g) => !g.address.trim()).length;
  return `<div class="guest-summary">
    <span class="pill ${ready === n ? "ok" : "muted"}">${t("guests.ready", { r: ready, n })}</span>
    ${next ? `<button class="chip" data-action="next-guest">${t("guests.next")} →</button>` : ""}
    ${withAddress && without > 1 ? `<button class="chip" data-action="address-all" data-guest="${withAddress.id}">${esc(t("guests.useAddressAll", { name: firstName(withAddress) }))}</button>` : ""}
  </div>`;
}

// The to-do list before export, with every item jumping to the field that needs it.
function reportItems(stay) {
  const property = findProperty(stay.propertyId);
  const items = [];
  for (const issue of stayIssues(stay, property, today())) {
    if (issue.code === "badGuests") {
      for (const id of issue.params.ids) {
        const g = stay.guests.find((x) => x.id === id);
        const fields = [...new Set(issuesOf(stay, g).filter((i) => i.level === "error").map((i) => t(FIELD_LABEL[i.field] || "f.surname")))];
        items.push({ text: `${guestName(g)} — ${t("guest.missing", { list: fields.join(", ") })}`, guest: id });
      }
    } else if (issue.code === "unreviewed") {
      for (const id of issue.params.ids) items.push({ text: `${guestName(stay.guests.find((x) => x.id === id))} — ${t("guest.needsReview")}`, guest: id });
    } else {
      const target = { chooseProperty: "in-property", noIdub: "settings", dates: stay.arrival ? "in-departure" : "in-arrival", datesInvalid: "in-arrival", datesOrder: "in-departure", noGuests: "sec-guests" }[issue.code];
      items.push({ text: t("s." + issue.code, issue.params || {}), target });
    }
  }
  return items;
}

// Everything in the "Report to the police" card that depends on the current data.
function renderReport(stay) {
  const property = findProperty(stay.propertyId);
  const stage = stageOf(stay);
  const items = reportItems(stay);
  const apartmentWarnings = propertyIssues(property).filter((i) => i.level === "warn");
  const fresh = stay.export && stay.export.fp === currentFp(stay);
  const attempted = showAll.has(stay.id);
  const banner =
    stage === "changedAfterReport" ? `<p class="banner bad">${t("report.changedAfterReport")}</p>`
    : stage === "changed" && stay.export ? `<p class="banner warn">${t("report.changedSinceExport")}</p>` : "";
  const status = items.length
    ? `<p class="still">${t("report.stillNeeded")}</p><ul class="todo ${attempted ? "attempted" : ""}">${items
        .map((it) => `<li><button class="todo-item" data-action="jump" ${it.guest ? `data-guest="${it.guest}"` : `data-target="${it.target}"`}>${esc(it.text)}${ICON.chevron}</button></li>`)
        .join("")}</ul>`
    : `<p class="all-good"><svg viewBox="0 0 24 24" class="draw-check"><circle cx="12" cy="12" r="10"/><path d="m7 12.5 3.3 3.3L17 9"/></svg>${t("report.allGood")}</p>`;
  const apartment = apartmentWarnings.length
    ? `<p class="still">${t("report.apartmentWarnings")}</p><ul class="warnings">${apartmentWarnings.map((i) => `<li>${esc(t("pw." + i.code))}</li>`).join("")}</ul>` : "";
  const reported = stage === "reported" && stay.report
    ? `<p class="all-good">${ICON.check}${t("report.reportedOn", { date: esc(niceDateTime(stay.report.at)), method: t(stay.report.method === "form" ? "report.methodForm" : "report.methodFile") })}${stay.report.ref ? ` · ${esc(stay.report.ref)}` : ""}</p>
       <button data-action="reopen">↺ ${t("report.reopen")}</button>`
    : `<button class="success" data-action="open-report-sheet" ${items.length ? "disabled" : ""}>${ICON.check}${t("report.confirm")}</button>`;
  return `${banner}${status}${apartment}
    <div class="rsteps">
      <div class="rstep"><span class="rnum">1</span><div>
        <div class="row-buttons file-actions">
          <button class="primary" data-action="export">${ICON.download}${t(stay.export && !fresh ? "report.downloadAgain" : "report.download")}</button>
          <button class="preview-btn" data-action="preview-file" aria-label="${t("report.preview")}" title="${t("report.preview")}">${ICON.eye}<span class="btn-label">${t("report.preview")}</span></button>
        </div>
        ${stay.export ? `<div class="muted small">${t("report.downloaded", { date: esc(niceDateTime(stay.export.at)) })}</div>` : ""}
      </div></div>
      <div class="rstep"><span class="rnum">2</span><div>${t("report.upload", { url: UBYPORT_URL })}</div></div>
      <div class="rstep"><span class="rnum">3</span><div>${stage === "reported" ? "" : t("report.receipt")} ${reported}</div></div>
    </div>`;
}

function mrzBadge(g) {
  const mrz = mrzState(g);
  if (mrz.state === "ok") return `<span class="pill ok" title="${esc(t("guest.verifiedTitle"))}">${ICON.check}${t("guest.mrzOk")}</span>`;
  if (mrz.state === "failed") return `<span class="pill bad">⚠ ${t("guest.mrzFailed")}</span>`;
  if (mrz.state === "edited") return `<span class="pill warn">⚠ ${t("guest.mrzEdited")}</span>`;
  return "";
}

function renderGuestRow(stay, g, i) {
  const issues = issuesOf(stay, g);
  const missing = [...new Set(issues.filter((x) => x.level === "error").map((x) => t(FIELD_LABEL[x.field] || "f.surname")))];
  const status = guestReady(stay, g)
    ? `<span class="pill ok">${ICON.check}${t("guest.reviewed")}</span>`
    : missing.length && !isBlank(g) ? `<span class="pill bad">${esc(t("guest.missing", { list: missing.join(", ") }))}</span>`
    : `<span class="pill warn">${t("guest.needsReview")}</span>`;
  const doc = g.documentNumber ? ` · ••••${esc(g.documentNumber.slice(-4))}` : "";
  return `${avatar(g)}<span class="guest-name"><strong>${esc(guestName(g))}</strong>
      <span class="muted small meta">${g.nationality ? `${flag(g.nationality)} ${esc(countryName(g.nationality))}` : `#${i + 1}`}${doc}</span>
      <span class="pills">${mrzBadge(g)}${status}</span></span><span class="chev">${ICON.chevron}</span>`;
}

// Messages under one field: warnings always, errors once the field was visited.
function fieldMessages(stay, g, field, issues) {
  const own = issues.filter((i) => i.field === field && (i.level === "warn" || errorsVisible(stay, g, field)));
  return own.map((i) => `<span class="msg ${i.level}">${esc(t("v." + i.code, i.params || {}))}</span>`).join("");
}

const fieldInvalid = (stay, g, field, issues) => errorsVisible(stay, g, field) && issues.some((i) => i.field === field && i.level === "error");

function renderGuestTop(stay, g) {
  const general = issuesOf(stay, g).filter((i) => !i.field);
  const hint = isBlank(g) && !showAll.has(g.id) && !showAll.has(stay.id) ? `<p class="hint-box">${t("guest.newHint")}</p>` : "";
  return hint + general.map((i) => `<p class="msg warn">${esc(t("v." + i.code, i.params || {}))}</p>`).join("");
}

function renderAddressChips(stay, g) {
  if (g.address.trim()) return "";
  return stay.guests
    .filter((o) => o !== g && o.address.trim())
    .slice(0, 2)
    .map((o) => `<button class="chip" data-action="use-address" data-guest="${g.id}" data-from="${o.id}">${esc(t("guest.useAddress", { name: firstName(o) }))}</button>`)
    .join("");
}

function renderGuestActions(stay, g) {
  return isReviewed(g) && !hasErrors(stay, g)
    ? `<p class="reviewed">${ICON.check}${t("guest.reviewed")}</p>`
    : `<div class="review"><button class="success" data-action="review-guest" data-guest="${g.id}">${ICON.check}${t("guest.review")}</button>
        <span class="muted small">${t("guest.reviewHint")}</span></div>`;
}

function renderGuestPhotos(g) {
  const list = photos.get(g.id);
  if (!list?.length) return "";
  return `<div class="guest-photos">${list
    .map((p, k) => `<button class="thumb" data-action="view-photo" data-guest="${g.id}" data-k="${k}" aria-label="${esc(t("guest.photo", { n: k + 1 }))}">
      <img src="${p.url}" style="--rot:${p.rotation * 90}deg" alt=""></button>`)
    .join("")}</div>`;
}

function nationalityButton(g) {
  return g.nationality ? `${flag(g.nationality)} ${esc(countryName(g.nationality))} (${g.nationality})` : t("stay.choose");
}

function renderGuest(stay, g, i) {
  const open = expanded.has(g.id);
  const issues = issuesOf(stay, g);
  const attrs = (field) => {
    const invalid = fieldInvalid(stay, g, field, issues);
    return `id="in-${g.id}-${field}" data-guest="${g.id}" data-field="${field}" aria-describedby="msg-${g.id}-${field}" ${invalid ? 'aria-invalid="true"' : ""}`;
  };
  const wrap = (field, control, extra = "") => `<div class="field">
      <label for="in-${g.id}-${field}">${t(FIELD_LABEL[field])}</label>${control}${extra}
      <div class="field-msg" id="msg-${g.id}-${field}" data-msg="${field}">${fieldMessages(stay, g, field, issues)}</div></div>`;
  const text = (field, more = "") => wrap(field, `<input ${attrs(field)} value="${esc(g[field])}" ${more}>`);
  return `
  <div class="guest ${open ? "open" : ""} ${freshGuests.has(g.id) ? "pop-in" : ""}" style="--i:${i}" data-guest-card="${g.id}">
    <button class="guest-row" data-action="toggle-guest" data-guest="${g.id}" aria-expanded="${open}" aria-controls="gbody-${g.id}">
      <span class="guest-head" data-status="guest-row">${renderGuestRow(stay, g, i)}</span>
    </button>
    <div class="guest-body" id="gbody-${g.id}" ${open ? "" : "hidden"}>
      ${renderGuestPhotos(g)}
      <div data-status="guest-top">${renderGuestTop(stay, g)}</div>
      <div class="two">${text("surname", 'autocapitalize="words" autocomplete="off"')}${text("givenNames", 'autocapitalize="words" autocomplete="off"')}</div>
      <div class="two">
        ${wrap("birthDate", `<input type="date" ${attrs("birthDate")} value="${esc(g.birthDate)}">`)}
        ${wrap("nationality", `<button type="button" class="select-btn" ${attrs("nationality")} data-action="pick-country">${nationalityButton(g)}</button>`)}
      </div>
      <div class="two">${text("documentNumber", 'autocapitalize="characters" autocomplete="off"')}${text("visa", 'autocapitalize="characters" autocomplete="off"')}</div>
      ${wrap("address", `<input ${attrs("address")} value="${esc(g.address)}" placeholder="${esc(t("f.addressPlaceholder"))}" autocomplete="off">`, `<div class="chips" data-status="addr-chips">${renderAddressChips(stay, g)}</div>`)}
      <div class="two">
        ${wrap("purpose", `<select ${attrs("purpose")}>${PURPOSE_CODES.map((code) => `<option value="${code}" ${code === g.purpose ? "selected" : ""}>${code} · ${esc(t("purpose." + code))}</option>`).join("")}</select>`)}
        ${text("note", 'autocomplete="off"')}
      </div>
      <div data-status="guest-actions">${renderGuestActions(stay, g)}</div>
      <button class="link danger-link" data-action="remove-guest" data-guest="${g.id}">${t("guest.remove")}</button>
    </div>
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
      <h2>🏠 ${t("set.apartments")}</h2>
      <p class="muted small">${t("set.apartmentsHint")}</p>
      ${state.properties.map(renderProperty).join("")}
      <button class="wide ghost" data-action="add-property">${t("set.addApartment")}</button>
    </section>

    <section class="card">
      <h2>🔍 ${t("set.reading")}</h2>
      <p class="muted small">${t("set.readingHint")}</p>
      <label for="in-apikey">${t("set.apiKey")}</label>
      <input id="in-apikey" type="password" data-setting="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off">
      <label for="in-model">${t("set.model")}</label>
      <select id="in-model" data-setting="model">${Object.entries(MODELS).map(([id, key]) => `<option value="${id}" ${id === s.model ? "selected" : ""}>${esc(t(key))}</option>`).join("")}</select>
    </section>

    <section class="card">
      <h2>💾 ${t("set.backup")}</h2>
      <p class="muted small">${t("set.backupHint")}</p>
      <p class="backup-status"><b>${backupLine()}</b><br><span class="muted small">${t(storageMode === "persisted" ? "backup.storagePersisted" : "backup.storageBestEffort")}</span></p>
      <div class="row-buttons">
        <button class="primary" data-action="backup">${ICON.shield}${t("backup.now")}</button>
        <button data-action="pick-restore">${t("set.restore")}</button>
      </div>
    </section>

    <section class="card">
      <h2>🎨 ${t("set.look")}</h2>
      <div class="theme-grid">${THEMES.map(
        (th, i) => `<button class="theme-card ${s.theme === th.id ? "selected" : ""}" data-action="set-theme" data-theme-id="${th.id}" aria-pressed="${s.theme === th.id}">
          <span class="theme-preview" data-theme="${th.id}">${skylineSvg(11 + i)}</span>
          <span class="theme-name">${t(`theme.${th.id}.name`)}<span class="theme-check">${ICON.check}</span></span>
          <span class="theme-tag">${t(`theme.${th.id}.tag`)}</span>
        </button>`,
      ).join("")}</div>
      <p class="label">${t("set.language")}</p>
      <div class="segmented">${Object.keys(LANGS)
        .map((code) => `<button class="${getLang() === code ? "on" : ""}" data-action="set-lang" data-lang="${code}" aria-pressed="${getLang() === code}">${LANG_NAMES[code]}</button>`)
        .join("")}</div>
    </section>`;
}

function renderPropertySummary(p) {
  const issues = propertyIssues(p);
  const pill = issues.some((i) => i.level === "error") ? `<span class="pill bad">${t("set.idubMissing")}</span>`
    : issues.length ? `<span class="pill warn">${t("set.checkDetails")}</span>` : "";
  return `${aptDot(p)}<strong>${esc(p.label || p.name || t("set.newApartment"))}</strong> ${p.idub ? `<span class="muted small">IDUB ${esc(p.idub)}</span>` : ""} ${pill}`;
}

function renderProperty(p) {
  const f = (field, label, attrs = "") =>
    `<div><label for="in-${p.id}-${field}">${t(label)}</label><input id="in-${p.id}-${field}" data-property="${p.id}" data-field="${field}" value="${esc(p[field])}" ${attrs}></div>`;
  return `
  <details class="property" ${p.idub ? "" : "open"}>
    <summary data-status="property" data-id="${p.id}">${renderPropertySummary(p)}</summary>
    ${f("label", "p.label", `placeholder="${esc(t("p.labelPlaceholder"))}"`)}
    <div class="two">${f("idub", "p.idub", 'inputmode="numeric"')}${f("abbr", "p.abbr")}</div>
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

// Replaces markup only when it changed, so a button about to be tapped isn't swapped out.
function setHtml(el, html) {
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function refreshGuest(stay, g, i) {
  const card = document.querySelector(`[data-guest-card="${g.id}"]`);
  if (!card) return;
  const issues = issuesOf(stay, g);
  setHtml(card.querySelector('[data-status="guest-row"]'), renderGuestRow(stay, g, i));
  if (!expanded.has(g.id)) return;
  setHtml(card.querySelector('[data-status="guest-top"]'), renderGuestTop(stay, g));
  for (const field of GUEST_INPUTS) {
    setHtml(card.querySelector(`[data-msg="${field}"]`), fieldMessages(stay, g, field, issues));
    const input = card.querySelector(`#in-${g.id}-${field}`);
    if (fieldInvalid(stay, g, field, issues)) input?.setAttribute("aria-invalid", "true");
    else input?.removeAttribute("aria-invalid");
  }
  setHtml(card.querySelector(`#in-${g.id}-nationality`), nationalityButton(g));
  setHtml(card.querySelector('[data-status="addr-chips"]'), renderAddressChips(stay, g));
  setHtml(card.querySelector('[data-status="guest-actions"]'), renderGuestActions(stay, g));
}

// Updates status areas in place, leaving the inputs alone, so focus and the
// field the user is about to tap survive every keystroke.
function refreshStatus(onlyGuest) {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  if (stay) {
    setHtml(document.querySelector('[data-status="report"]'), renderReport(stay));
    setHtml(document.querySelector('[data-status="deadline"]'), renderDeadline(stay));
    setHtml(document.querySelector('[data-status="stepper"]'), renderStepper(stay));
    setHtml(document.querySelector('[data-status="guest-summary"]'), renderGuestSummary(stay));
    setHtml(document.querySelector('[data-status="head-details"]'), renderSectionHead(stay, "details"));
    setHtml(document.querySelector('[data-status="head-guests"]'), renderSectionHead(stay, "guests"));
    setHtml(document.getElementById("hero-text"), renderHeroText());
    stay.guests.forEach((g, i) => (!onlyGuest || g.id === onlyGuest) && refreshGuest(stay, g, i));
  }
  document.querySelectorAll('[data-status="property"]').forEach((el) => {
    const p = findProperty(el.dataset.id);
    if (p) setHtml(el, renderPropertySummary(p));
  });
}

// Layout changes while a finger is down can make the tap land on the wrong thing,
// so status updates triggered by leaving a field wait until the tap is over.
function refreshSoon(onlyGuest) {
  if (pointerDown) refreshPending = true;
  else refreshStatus(onlyGuest);
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

// Export attempt with something missing: show every problem and go to the list.
function showProblems(stay) {
  showAll.add(stay.id);
  sheet = null;
  for (const section of ["details", "guests"]) if (!sectionComplete(stay, section)) setSectionOpen(stay, section, true);
  const firstBad = stay.guests.find((g) => !guestReady(stay, g));
  if (firstBad) expanded.add(firstBad.id);
  render();
  focusField(document.getElementById("report-title"));
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

function pickPhotos() {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  if (stay && !isSectionOpen(stay, "guests")) {
    setSectionOpen(stay, "guests", true);
    render();
  }
  if (!state.settings.apiKey) return openSheet({ kind: "apikey", key: "", files: null });
  document.getElementById("photo-input").click();
}

function addToTray(files) {
  const stay = view.name === "stay" ? findStay(view.id) : null;
  const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!stay || !images.length || reading) return;
  if (!state.settings.apiKey) return openSheet({ kind: "apikey", key: "", files: images });
  if (tray?.stayId !== stay.id) discardTray();
  tray ||= { stayId: stay.id, items: [] };
  for (const file of images) tray.items.push({ id: uid(), file, url: URL.createObjectURL(file), rotation: 0 });
  refreshPhotoArea(stay);
}

function discardTray() {
  for (const it of tray?.items || []) URL.revokeObjectURL(it.url);
  tray = null;
}

function refreshPhotoArea(stay) {
  setHtml(document.querySelector('[data-status="photo-area"]'), renderPhotoArea(stay));
}

// Adds read guests to the stay, keeps their photos for review and opens the first one.
function addReadGuests(stay, items, guests) {
  const used = new Set();
  let firstNew = null;
  for (const { imageIndexes = [], ...g } of guests) {
    const guest = { ...emptyGuest(), ...g, id: uid() };
    const own = imageIndexes.map((k) => items[k]).filter(Boolean);
    own.forEach((it) => used.add(it));
    if (own.length) photos.set(guest.id, own.map((it) => ({ url: it.url, rotation: it.rotation })));
    freshGuests.add(guest.id);
    stay.guests.push(guest);
    firstNew ||= guest;
  }
  for (const it of items) if (!used.has(it)) URL.revokeObjectURL(it.url);
  if (firstNew && ![...expanded].some((id) => stay.guests.some((g) => g.id === id))) expanded.add(firstNew.id);
  if (guests.length) noteChange();
  saveNow();
}

async function readTray() {
  const stay = findStay(tray?.stayId);
  if (!stay || !tray.items.length) return;
  const items = tray.items;
  tray = null;
  reading = { stayId: stay.id, phase: "prepare", i: 0, n: items.length, batch: 1, batches: 1, sentAt: null, controller: new AbortController() };
  flash = null;
  render();
  const onProgress = (p) => {
    if (!reading) return;
    if (p.phase === "batch") Object.assign(reading, { batch: p.i, batches: p.n });
    else if (p.phase === "prepare") Object.assign(reading, { phase: "prepare", i: p.i, n: p.n });
    else Object.assign(reading, { phase: p.phase, sentAt: p.phase === "send" ? Date.now() : reading.sentAt });
    updateProgress();
  };
  try {
    const { guests, unusable } = await readDocuments(items, { ...state.settings, noteLanguage: t("noteLanguage"), signal: reading.controller.signal, onProgress });
    reading = null;
    addReadGuests(stay, items, guests);
    const parts = [guests.length ? t("toast.found", { n: guests.length }) : t("toast.foundNone")];
    if (unusable.length) parts.push(t("toast.skipped", { list: unusable.join("; ") }));
    showFlash(guests.length ? "ok" : "error", parts.join(" · "));
  } catch (err) {
    reading = null;
    const partial = err.partial?.guests || [];
    addReadGuests(stay, items, partial);
    const { key, detail } = apiErrorKey(err);
    const message = t(key);
    if (key === "toast.cancelled") showFlash("ok", message);
    else showFlash("error", partial.length ? t("toast.partialError", { error: message }) : message, null, detail);
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

function openGuest(stay, id, { focus = true } = {}) {
  expanded.add(id);
  setSectionOpen(stay, "guests", true);
  render();
  const card = document.querySelector(`[data-guest-card="${id}"]`);
  if (!card) return;
  const target = focus ? card.querySelector('[aria-invalid="true"]') || card.querySelector(".guest-body input, .guest-body button") : null;
  if (target) focusField(target);
  else card.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || (el.tagName === "INPUT" && el.type !== "button")) return;
  const action = el.dataset.action;
  const stay = view.name === "stay" ? findStay(view.id) : null;
  const guest = stay && el.dataset.guest ? stay.guests.find((x) => x.id === el.dataset.guest) : null;

  switch (action) {
    case "nav":
      go(el.dataset.view);
      return;
    case "dismiss-flash":
      flash = null;
      break;
    case "toast-action": {
      const run = flash?.action?.run;
      flash = null;
      run?.();
      if (!run) break;
      return;
    }
    case "close-sheet":
      closeSheet();
      return;
    case "new-stay": {
      const s = { id: uid(), propertyId: state.properties.length === 1 ? state.properties[0].id : "", arrival: today(), departure: "", label: "", guests: [], createdAt: new Date().toISOString(), export: null, report: null };
      state.stays.push(s);
      save();
      go("stay", s.id);
      return;
    }
    case "open-stay":
      go("stay", el.dataset.id);
      return;
    case "jump-section": {
      const section = document.getElementById(el.dataset.target);
      const name = { "sec-details": "details", "sec-guests": "guests" }[el.dataset.target];
      if (name && !isSectionOpen(stay, name)) {
        setSectionOpen(stay, name, true);
        render();
      }
      focusField(document.getElementById(el.dataset.target)?.querySelector("h2") || section);
      return;
    }
    case "toggle-section":
      setSectionOpen(stay, el.dataset.section, !isSectionOpen(stay, el.dataset.section));
      break;
    case "preview-file":
      openSheet({ kind: "preview", stayId: stay.id, mode: "readable" });
      return;
    case "preview-mode":
      sheet.mode = el.dataset.mode;
      shownSheet = null;
      renderSheet();
      return;
    case "set-nights":
      if (!stay.arrival) return focusField(document.getElementById("in-arrival"));
      stay.departure = addDays(stay.arrival, Number(el.dataset.n));
      document.getElementById("in-departure").value = stay.departure;
      save();
      refreshStatus();
      return;
    case "pick-photos":
      pickPhotos();
      return;
    case "tray-rotate": {
      const it = tray?.items.find((x) => x.id === el.dataset.id);
      if (it) it.rotation = (it.rotation + 1) % 4;
      refreshPhotoArea(stay);
      return;
    }
    case "tray-remove": {
      const it = tray?.items.find((x) => x.id === el.dataset.id);
      if (it) {
        URL.revokeObjectURL(it.url);
        tray.items = tray.items.filter((x) => x !== it);
      }
      if (!tray.items.length) tray = null;
      refreshPhotoArea(stay);
      return;
    }
    case "tray-cancel":
      discardTray();
      refreshPhotoArea(stay);
      return;
    case "tray-read":
      readTray();
      return;
    case "cancel-reading":
      reading?.controller.abort();
      return;
    case "add-guest": {
      const g = emptyGuest();
      freshGuests.add(g.id);
      stay.guests.push(g);
      noteChange();
      save();
      openGuest(stay, g.id);
      return;
    }
    case "toggle-guest":
      if (expanded.has(guest.id)) expanded.delete(guest.id);
      else expanded.add(guest.id);
      break;
    case "next-guest": {
      const next = stay.guests.find((g) => !guestReady(stay, g));
      if (next) openGuest(stay, next.id);
      return;
    }
    case "review-guest": {
      if (hasErrors(stay, guest)) {
        showAll.add(guest.id);
        refreshStatus(guest.id);
        focusField(document.querySelector(`[data-guest-card="${guest.id}"] [aria-invalid="true"]`));
        return;
      }
      guest.reviewedFp = guestFingerprint(guest);
      save();
      expanded.delete(guest.id);
      const next = stay.guests.find((g) => !guestReady(stay, g));
      if (next) return openGuest(stay, next.id, { focus: false });
      setSectionOpen(stay, "guests", false);
      render();
      focusField(document.getElementById("report-title"));
      return;
    }
    case "remove-guest": {
      const index = stay.guests.indexOf(guest);
      stay.guests.splice(index, 1);
      noteChange();
      save();
      undoable(t("guest.removed", { name: guestName(guest) }), () => {
        stay.guests.splice(index, 0, guest);
        save();
        render();
      });
      return;
    }
    case "use-address": {
      const from = stay.guests.find((x) => x.id === el.dataset.from);
      if (from && guest) guest.address = from.address;
      document.getElementById(`in-${guest.id}-address`).value = guest.address;
      save();
      refreshStatus();
      return;
    }
    case "address-all": {
      for (const g of stay.guests) if (!g.address.trim()) g.address = guest.address;
      save();
      break;
    }
    case "pick-country":
      openSheet({ kind: "country", guestId: el.dataset.guest, query: "" });
      return;
    case "choose-country": {
      const g = stay?.guests.find((x) => x.id === sheet?.guestId);
      if (g) g.nationality = el.dataset.code;
      save();
      closeSheet();
      return;
    }
    case "view-photo": {
      const p = photos.get(el.dataset.guest)?.[Number(el.dataset.k)];
      if (p) openSheet({ kind: "photo", url: p.url, rotation: p.rotation, k: Number(el.dataset.k), zoom: false });
      return;
    }
    case "toggle-zoom":
      sheet.zoom = !sheet.zoom;
      document.querySelector(".viewer")?.classList.toggle("zoomed", sheet.zoom);
      return;
    case "jump": {
      if (el.dataset.guest) {
        showAll.add(el.dataset.guest);
        return openGuest(stay, el.dataset.guest);
      }
      if (el.dataset.target === "settings") return go("settings");
      revealSection(stay, document.getElementById(el.dataset.target));
      const target = document.getElementById(el.dataset.target);
      focusField(target?.tagName === "SECTION" ? target.querySelector("h2") : target);
      return;
    }
    case "export": {
      const target = stay || findStay(sheet?.stayId);
      if (!target) return;
      if (stayIssues(target, findProperty(target.propertyId), today()).length) return showProblems(target);
      exportFiles([target]);
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
      flash = { kind: "ok", text: t("toast.reported") };
      confetti();
      go("stays");
      return;
    }
    case "reopen":
      stay.report = null;
      saveNow();
      break;
    case "delete-stay": {
      const index = state.stays.indexOf(stay);
      state.stays.splice(index, 1);
      noteChange();
      save();
      flash = { kind: "ok", text: t("stay.deleted"), action: { label: t("toast.undo"), run: () => {
        state.stays.splice(index, 0, stay);
        save();
        go("stay", stay.id);
      } } };
      go("stays");
      return;
    }
    case "copy-guest-message":
      copy(tIn(el.dataset.lang, "guestMessage"));
      return;
    case "copy":
      copy(el.dataset.text);
      return;
    case "add-property": {
      const hues = state.properties.map(propertyHue);
      state.properties.push(emptyProperty((hues.length * 67 + 15) % 360));
      noteChange();
      save();
      break;
    }
    case "remove-property": {
      const index = state.properties.findIndex((p) => p.id === el.dataset.id);
      const [removed] = state.properties.splice(index, 1);
      noteChange();
      save();
      undoable(t("set.apartmentRemoved"), () => {
        state.properties.splice(index, 0, removed);
        save();
        render();
      });
      return;
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
    case "open-lang":
      openSheet({ kind: "lang" });
      return;
    case "set-lang":
      sheet = null;
      changeLanguage(el.dataset.lang);
      return;
    case "save-key": {
      const key = (sheet.key || "").trim();
      if (!key) return document.getElementById("sheet-key")?.focus();
      const pending = sheet.files;
      state.settings.apiKey = key;
      saveNow();
      closeSheet();
      if (pending) addToTray(pending);
      else document.getElementById("photo-input").click();
      return;
    }
    case "key-manual": {
      closeSheet();
      document.querySelector('[data-action="add-guest"]')?.click();
      return;
    }
    case "backup":
      backupNow();
      return;
    case "backup-later":
      state.settings.backupSnoozeUntil = new Date(Date.now() + 3 * DAY).toISOString();
      save();
      break;
    case "pick-restore":
      document.getElementById("restore-input").click();
      return;
    case "restore-confirm": {
      const previous = JSON.stringify(state);
      try {
        localStorage.setItem(BEFORE_RESTORE_KEY, previous);
      } catch {}
      const data = sheet.result.data;
      sheet = null;
      replaceState({ ...data, settings: { ...data.settings, apiKey: state.settings.apiKey } });
      undoable(t("toast.restored"), () => {
        replaceState(JSON.parse(previous));
        showFlash("ok", t("toast.restoreUndone"));
      });
      go("stays");
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
    } else if (el.dataset.sheetField === "query") {
      setHtml(document.querySelector('[data-status="country-list"]'), countryOptions(sheet.query));
    } else document.querySelector('[data-action="confirm-report"]')?.toggleAttribute("disabled", !sheet.checked);
    return;
  }
  let onlyGuest;
  if (el.dataset.guest && el.dataset.field) {
    const g = findStay(view.id)?.guests.find((x) => x.id === el.dataset.guest);
    if (g) g[el.dataset.field] = el.value;
    onlyGuest = el.dataset.guest;
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
  if (!onlyGuest) return refreshStatus();
  // While typing a guest's details, update that guest now and the rest of the page once typing pauses.
  const stay = findStay(view.id);
  const index = stay.guests.findIndex((g) => g.id === onlyGuest);
  refreshGuest(stay, stay.guests[index], index);
  clearTimeout(stayRefreshTimer);
  stayRefreshTimer = setTimeout(() => refreshStatus(onlyGuest), 180);
});

document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset.action === "photos") {
    const files = [...el.files];
    el.value = "";
    addToTray(files);
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

// Errors for a field appear once it has been visited.
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (!el.dataset?.guest || !el.dataset.field || el.dataset.field === "nationality") return;
  const key = `${el.dataset.guest}:${el.dataset.field}`;
  if (touched.has(key)) return;
  touched.add(key);
  refreshSoon(el.dataset.guest);
});

document.addEventListener("pointerdown", () => (pointerDown = true), true);
const pointerEnd = () => {
  pointerDown = false;
  if (refreshPending) {
    refreshPending = false;
    setTimeout(() => refreshStatus(), 0);
  }
};
document.addEventListener("pointerup", pointerEnd, true);
document.addEventListener("pointercancel", pointerEnd, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet) closeSheet();
});

// Photos copied in WhatsApp (or a screenshot) can be pasted straight in, or dropped on a computer.
document.addEventListener("paste", (e) => {
  if (view.name !== "stay") return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  addToTray(files);
});
document.addEventListener("dragover", (e) => view.name === "stay" && e.dataTransfer?.types.includes("Files") && e.preventDefault());
document.addEventListener("drop", (e) => {
  if (view.name !== "stay" || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  addToTray([...e.dataTransfer.files]);
});

addEventListener("popstate", applyRoute);
// A hash typed into the address bar.
addEventListener("hashchange", () => viewKey(parseRoute()) !== viewKey(view) && applyRoute());

// Drafts left empty from an earlier visit are cleared on start.
for (const s of [...state.stays]) if (!(view.name === "stay" && view.id === s.id)) dropIfEmpty(s.id);
if (view.name === "stay" && !findStay(view.id)) {
  history.replaceState(null, "", "#/");
  view = { name: "stays" };
}

if (view.name === "stay") foldCompleteSections(findStay(view.id));
setLang(state.settings.lang || DEFAULT_LANG);
applyTheme(state.settings.theme);
mountShell();
render();
watchScroll();
requestPersistence().then((mode) => {
  storageMode = mode;
  if (view.name === "settings") render();
});
