// Parses and checks passport (TD3, 2×44) and ID-card (TD1, 3×30) machine-readable zones.
// Used to double-check what was read off the photo: a failed check digit
// almost always means a misread character in the number or a date.

// ICAO codes that differ from the ISO alpha-3 codes Ubyport expects.
const ICAO_TO_ISO = { D: "DEU", GBD: "GBR", GBN: "GBR", GBO: "GBR", GBP: "GBR", GBS: "GBR", RKS: "XXK", XKX: "XXK", UNK: "XXK" };

export function normalizeCountry(code) {
  const c = String(code || "").toUpperCase().replace(/</g, "").trim();
  return ICAO_TO_ISO[c] || c;
}

function charValue(ch) {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0; // "<"
}

export function checkDigit(field) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += charValue(field[i]) * weights[i % 3];
  return String(sum % 10);
}

function ok(field, digit) {
  return checkDigit(field) === digit;
}

// "YYMMDD" -> "YYYY-MM-DD". Birth dates are never in the future; expiry dates rarely in the far past.
function mrzDate(yymmdd, kind) {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const nowYY = new Date().getFullYear() % 100;
  const century = kind === "birth" ? (yy > nowYY ? 1900 : 2000) : yy >= 70 ? 1900 : 2000;
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function names(field) {
  const [surname, given = ""] = field.split("<<");
  const tidy = (s) => s.replace(/<+/g, " ").trim();
  return { surname: tidy(surname), givenNames: tidy(given) };
}

function tidyLine(line, len) {
  return String(line || "").toUpperCase().replace(/[\s«]/g, "<").replace(/[^A-Z0-9<]/g, "").padEnd(len, "<").slice(0, len);
}

export function parseMrz(lines) {
  const raw = lines.map((l) => String(l || "").trim()).filter(Boolean);
  if (raw.length === 2 && raw[0].length >= 40) return parseTd3(raw.map((l) => tidyLine(l, 44)));
  if (raw.length === 3) return parseTd1(raw.map((l) => tidyLine(l, 30)));
  return null;
}

function parseTd3([l1, l2]) {
  const docNo = l2.slice(0, 9);
  const birth = l2.slice(13, 19);
  const expiry = l2.slice(21, 27);
  const optional = l2.slice(28, 42);
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  const checks = {
    documentNumber: ok(docNo, l2[9]),
    birthDate: ok(birth, l2[19]),
    expiryDate: ok(expiry, l2[27]),
    composite: ok(composite, l2[43]),
  };
  // Optional-data check digit may be "<" when the field is empty.
  if (!(optional.replace(/</g, "") === "" && (l2[42] === "<" || l2[42] === "0"))) checks.optional = ok(optional, l2[42]);
  return {
    format: "TD3",
    ...names(l1.slice(5)),
    issuingCountry: normalizeCountry(l1.slice(2, 5)),
    documentNumber: docNo.replace(/</g, ""),
    nationality: normalizeCountry(l2.slice(10, 13)),
    birthDate: mrzDate(birth, "birth"),
    sex: l2[20] === "<" ? "" : l2[20],
    expiryDate: mrzDate(expiry, "expiry"),
    checks,
    valid: Object.values(checks).every(Boolean),
  };
}

function parseTd1([l1, l2, l3]) {
  let docNo = l1.slice(5, 14);
  let docCheck = l1[14];
  // Long document numbers continue in the optional field, with "<" in the check position.
  if (docCheck === "<") {
    const ext = l1.slice(15, 30).split("<")[0];
    docNo = docNo + ext.slice(0, -1);
    docCheck = ext.slice(-1);
  }
  const birth = l2.slice(0, 6);
  const expiry = l2.slice(8, 14);
  const composite = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);
  const checks = {
    documentNumber: ok(docNo, docCheck),
    birthDate: ok(birth, l2[6]),
    expiryDate: ok(expiry, l2[14]),
    composite: ok(composite, l2[29]),
  };
  return {
    format: "TD1",
    ...names(l3),
    issuingCountry: normalizeCountry(l1.slice(2, 5)),
    documentNumber: docNo.replace(/</g, ""),
    nationality: normalizeCountry(l2.slice(15, 18)),
    birthDate: mrzDate(birth, "birth"),
    sex: l2[7] === "<" ? "" : l2[7],
    expiryDate: mrzDate(expiry, "expiry"),
    checks,
    valid: Object.values(checks).every(Boolean),
  };
}
