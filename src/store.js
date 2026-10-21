// Loading, migrating, saving and backing up the app's data (all kept in this browser).
import { isRealDate, guestFingerprint, stayFingerprint } from "./validate.js";

export const STORAGE_KEY = "ubyport-helper-v1";
export const BEFORE_RESTORE_KEY = "ubyport-helper-before-restore";
export const VERSION = 2;

export const defaultSettings = () => ({
  apiKey: "", model: "claude-opus-5-5", theme: "prague", lang: "",
  lastBackupAt: null, changesSinceBackup: 0, backupSnoozeUntil: null,
});

const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));

function cleanProperty(p) {
  const out = { id: str(p.id, 40) };
  for (const f of ["label", "idub", "abbr", "name", "contact", "district", "municipality", "municipalityPart", "street", "houseNumber", "orientationNumber", "zip"]) out[f] = str(p[f]);
  if (Number.isFinite(p.hue)) out.hue = p.hue;
  return out;
}

function cleanGuest(g) {
  const out = { id: str(g.id, 40) };
  for (const f of ["surname", "givenNames", "sex", "nationality", "documentType", "documentNumber", "issuingCountry", "visa", "address", "purpose", "note", "readerProblems", "reviewedFp"])
    out[f] = str(g[f], f === "address" || f === "note" || f === "readerProblems" ? 500 : 200);
  out.birthDate = isRealDate(g.birthDate) ? g.birthDate : "";
  out.expiryDate = isRealDate(g.expiryDate) ? g.expiryDate : "";
  out.purpose ||= "10";
  out.mrzLines = Array.isArray(g.mrzLines) ? g.mrzLines.slice(0, 3).map((l) => str(l, 60)) : [];
  out.mrz = g.mrz && typeof g.mrz === "object" ? { valid: !!g.mrz.valid, mismatches: Array.isArray(g.mrz.mismatches) ? g.mrz.mismatches.filter((m) => m && typeof m === "object") : [] } : null;
  return out;
}

function cleanStamp(s) {
  return s && typeof s === "object" && typeof s.at === "string" ? { at: s.at, fp: str(s.fp, 40), method: str(s.method, 20), ref: str(s.ref, 100) } : null;
}

function cleanStay(s) {
  return {
    id: str(s.id, 40),
    propertyId: str(s.propertyId, 40),
    arrival: isRealDate(s.arrival) ? s.arrival : "",
    departure: isRealDate(s.departure) ? s.departure : "",
    label: str(s.label, 300),
    createdAt: str(s.createdAt, 40),
    guests: Array.isArray(s.guests) ? s.guests.filter((g) => g && typeof g === "object").map(cleanGuest) : [],
    export: cleanStamp(s.export),
    report: cleanStamp(s.report),
  };
}

// Brings data from older versions up to date. Old exportedAt/submittedAt
// timestamps become stamps of the data as it is now, and guests in stays that
// were already exported or reported count as reviewed.
export function migrate(raw) {
  const data = { ...raw };
  const properties = (Array.isArray(data.properties) ? data.properties : []).filter((p) => p && typeof p === "object").map(cleanProperty);
  const stays = (Array.isArray(data.stays) ? data.stays : []).filter((s) => s && typeof s === "object").map((s) => {
    const stay = cleanStay(s);
    const property = properties.find((p) => p.id === stay.propertyId);
    const fp = property ? stayFingerprint(stay, property) : "";
    if (!stay.export && typeof s.exportedAt === "string") stay.export = { at: s.exportedAt, fp, method: "file", ref: "" };
    if (!stay.report && typeof s.submittedAt === "string") stay.report = { at: s.submittedAt, fp, method: "file", ref: "" };
    if ((stay.export || stay.report) && (data.version ?? 1) < 2) for (const g of stay.guests) g.reviewedFp ||= guestFingerprint(g);
    return stay;
  });
  return { version: VERSION, settings: { ...defaultSettings(), ...(data.settings || {}) }, properties, stays };
}

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return migrate(saved);
  } catch {}
  return migrate({});
}

// Saves shortly after the last change, or immediately with flush().
export function createSaver(getState, onStatus) {
  let timer = null;
  const write = () => {
    clearTimeout(timer);
    timer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
      onStatus("saved");
    } catch (e) {
      onStatus("error", e);
    }
  };
  const flushIfPending = () => timer && write();
  addEventListener("pagehide", flushIfPending);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushIfPending());
  return {
    soon() {
      onStatus("saving");
      clearTimeout(timer);
      timer = setTimeout(write, 400);
    },
    now: write,
  };
}

export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return "unsupported";
    if (await navigator.storage.persisted()) return "persisted";
    return (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

export function backupPayload(state) {
  return {
    app: "ubyport-helper",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings, apiKey: "" },
    properties: state.properties,
    stays: state.stays,
  };
}

// Checks a backup file before anything is replaced. Returns the cleaned data and a summary.
export function validateBackup(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "notBackup" };
  if (!Array.isArray(raw.stays) || !Array.isArray(raw.properties)) return { ok: false, error: "notBackup" };
  if (raw.version && raw.version > VERSION) return { ok: false, error: "newerVersion" };
  const bad = (list, test) => list.some((x) => !x || typeof x !== "object" || !test(x));
  if (bad(raw.properties, (p) => typeof p.id === "string" && p.id)) return { ok: false, error: "corrupt" };
  if (bad(raw.stays, (s) => typeof s.id === "string" && s.id && (s.guests === undefined || Array.isArray(s.guests)))) return { ok: false, error: "corrupt" };
  const data = migrate(raw);
  const ids = new Set(data.properties.map((p) => p.id));
  const orphans = data.stays.filter((s) => s.propertyId && !ids.has(s.propertyId)).length;
  return {
    ok: true,
    data,
    summary: {
      apartments: data.properties.length,
      stays: data.stays.length,
      guests: data.stays.reduce((n, s) => n + s.guests.length, 0),
      createdAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
      orphans,
    },
  };
}
