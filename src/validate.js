// Pure rules about guests, stays and apartments: completeness, passport-code checks,
// human review and whether an export or report still matches the current data.
// Everything returns codes; app.js turns them into translated text.
import { COUNTRIES } from "./countries.js";
import { parseMrz } from "./mrz.js";
import { encodeCp1250 } from "./unl.js";

export const GUEST_FIELDS = ["surname", "givenNames", "birthDate", "nationality", "address", "documentNumber", "visa", "purpose", "note"];
export const PROPERTY_FIELDS = ["idub", "abbr", "name", "contact", "district", "municipality", "municipalityPart", "street", "houseNumber", "orientationNumber", "zip"];
const MRZ_FIELDS = ["documentNumber", "birthDate", "nationality"];

export function isRealDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// FNV-1a, enough to notice that reportable data changed.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const pick = (obj, fields) => fields.map((f) => String(obj?.[f] ?? "").trim());

export function guestFingerprint(g) {
  return hash(JSON.stringify(pick(g, GUEST_FIELDS)));
}

// Covers everything that ends up in the Ubyport file for this stay.
export function stayFingerprint(stay, property) {
  return hash(JSON.stringify([pick(property, PROPERTY_FIELDS), stay.arrival, stay.departure, stay.guests.map((g) => pick(g, GUEST_FIELDS))]));
}

export const isReviewed = (g) => !!g.reviewedFp && g.reviewedFp === guestFingerprint(g);

// Re-checks the stored passport code against the current values, so a hand edit
// can't keep a stale "Passport code OK".
export function mrzState(g) {
  const lines = Array.isArray(g.mrzLines) ? g.mrzLines : [];
  const mrz = lines.length ? parseMrz(lines) : null;
  if (!mrz) return { state: "none", fields: [] };
  if (!mrz.valid) {
    const fields = [];
    if (!mrz.checks.documentNumber) fields.push("documentNumber");
    if (!mrz.checks.birthDate) fields.push("birthDate");
    return { state: "failed", fields };
  }
  const edited = MRZ_FIELDS.filter((f) => mrz[f] && String(g[f] || "").trim().toUpperCase() !== mrz[f]);
  return edited.length ? { state: "edited", fields: edited, mrz } : { state: "ok", fields: [], mrz };
}

export function lossyChars(values) {
  return encodeCp1250(values.join(" ")).lossy;
}

// Issues: { field, level: "error" | "warn", code, params }
export function guestIssues(g, stay, today) {
  const out = [];
  const add = (field, level, code, params) => out.push({ field, level, code, params });
  if (!String(g.surname || "").trim()) add("surname", "error", "surname");
  if (!String(g.givenNames || "").trim()) add("givenNames", "warn", "givenNames");
  if (!g.birthDate) add("birthDate", "error", "birthMissing");
  else if (!isRealDate(g.birthDate)) add("birthDate", "error", "birthInvalid");
  else if (g.birthDate > today) add("birthDate", "error", "birthFuture");
  if (!g.nationality) add("nationality", "error", "nationalityMissing");
  else if (!COUNTRIES[g.nationality]) add("nationality", "error", "nationalityUnknown", { code: g.nationality });
  else if (g.nationality === "CZE") add("nationality", "error", "czech");
  const doc = String(g.documentNumber || "").trim();
  if (!doc) add("documentNumber", "error", "docMissing");
  else if (doc.length < 4 || doc.length > 30) add("documentNumber", "error", "docLength");
  if (!String(g.address || "").trim()) add("address", "error", "address");

  const mrz = mrzState(g);
  if (mrz.state === "failed") for (const f of mrz.fields.length ? mrz.fields : ["documentNumber"]) add(f, "warn", "mrzFailed");
  if (mrz.state === "edited") for (const f of mrz.fields) add(f, "warn", "mrzEdited", { value: mrz.mrz[f] });
  for (const m of g.mrz?.mismatches || []) if (typeof m === "object" && String(g[m.field]) === m.to) add(m.field, "warn", "corrected", { from: m.from });
  if (g.expiryDate && stay?.arrival && g.expiryDate < stay.arrival) add("documentNumber", "warn", "expired");
  for (const f of ["surname", "givenNames", "address", "note"]) {
    const chars = lossyChars([g[f] || ""]);
    if (chars.length) add(f, "warn", "lossy", { chars: chars.join(" ") });
  }
  if (g.readerProblems) add(null, "warn", "readerNote", { note: g.readerProblems });
  return out;
}

export function propertyIssues(p) {
  const out = [];
  if (!p) return out;
  const add = (field, level, code) => out.push({ field, level, code });
  if (!String(p.idub || "").trim()) add("idub", "error", "noIdub");
  if (!String(p.name || "").trim()) add("name", "warn", "pName");
  if (!String(p.street || "").trim() || !String(p.houseNumber || "").trim()) add("street", "warn", "pAddress");
  if (!String(p.municipality || "").trim()) add("municipality", "warn", "pMunicipality");
  const zip = String(p.zip || "").replace(/\s/g, "");
  if (!zip) add("zip", "warn", "pZip");
  else if (!/^\d{5}$/.test(zip)) add("zip", "warn", "pZipFormat");
  return out;
}

// Stay-level problems that block an export (guest errors are summarised, not repeated).
export function stayIssues(stay, property, today) {
  const out = [];
  const add = (code, params) => out.push({ code, params });
  if (!property) add("chooseProperty");
  else if (propertyIssues(property).some((i) => i.level === "error")) add("noIdub", { name: property.label || property.name || "" });
  if (!stay.arrival || !stay.departure) add("dates");
  else if (!isRealDate(stay.arrival) || !isRealDate(stay.departure)) add("datesInvalid");
  else if (stay.departure < stay.arrival) add("datesOrder");
  if (!stay.guests.length) add("noGuests");
  const incomplete = stay.guests.filter((g) => guestIssues(g, stay, today).some((i) => i.level === "error"));
  if (incomplete.length) add("badGuests", { n: incomplete.length, ids: incomplete.map((g) => g.id) });
  const unreviewed = stay.guests.filter((g) => !incomplete.includes(g) && !isReviewed(g));
  if (unreviewed.length) add("unreviewed", { n: unreviewed.length, ids: unreviewed.map((g) => g.id) });
  return out;
}

// Workflow stage, independent of the deadline:
// draft → review → ready → exported (or changed) → reported (or changedAfterReport)
export function stayStage(stay, property, today) {
  const fp = property ? stayFingerprint(stay, property) : null;
  if (stay.report) return stay.report.fp === fp ? "reported" : "changedAfterReport";
  const issues = stayIssues(stay, property, today);
  if (stay.export) return stay.export.fp === fp && !issues.length ? "exported" : "changed";
  if (issues.some((i) => i.code !== "unreviewed")) return "draft";
  if (issues.length) return "review";
  return "ready";
}

export function stayLossy(stay, property) {
  const values = [...pick(property, PROPERTY_FIELDS), ...stay.guests.flatMap((g) => pick(g, GUEST_FIELDS))];
  return lossyChars(values);
}
