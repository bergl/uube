// Builds Ubyport UNL import files.
//
// Format (as produced by github.com/martiner/ubyport, which uploads fine to Ubyport):
//   line 1:  A|2|IDUB|zkratka|ubytovatel|kontakt|okres|obec|cast obce|ulice|c.p.|c.o.|PSC|dd.MM.yyyy HH:mm:ss||
//   guests:  U|od|do|prijmeni|jmeno||narozeni|||stat|bydliste|doklad|vizum|ucel||poznamka
// Lines are joined with CRLF and the file is encoded in Windows-1250.

// Ubyport purpose-of-stay codes; their names are translated in i18n.js ("purpose.XX").
export const PURPOSE_CODES = ["00", "01", "02", "03", "04", "05", "06", "07", "10", "11", "12", "13", "27", "93", "99"];

// Fields must never contain the separator or line breaks.
function clean(value) {
  return String(value ?? "")
    .replace(/[|\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// "2026-10-21" -> "21.10.2026"
export function czDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function czDateTime(date) {
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function headerLine(property, exportedAt = new Date()) {
  return [
    "A",
    "2",
    property.idub,
    property.abbr,
    property.name,
    property.contact,
    property.district,
    property.municipality,
    property.municipalityPart,
    property.street,
    property.houseNumber,
    property.orientationNumber,
    property.zip,
    czDateTime(exportedAt),
    "",
    "",
  ]
    .map(clean)
    .join("|");
}

export function guestLine(stay, guest) {
  return [
    "U",
    czDate(stay.arrival),
    czDate(stay.departure),
    guest.surname,
    guest.givenNames,
    "",
    czDate(guest.birthDate),
    "",
    "",
    guest.nationality,
    guest.address,
    guest.documentNumber,
    guest.visa,
    guest.purpose || "10",
    "",
    guest.note,
  ]
    .map(clean)
    .join("|");
}

// entries: [{ stay, guest }] — all must belong to the same property.
export function buildUnl(property, entries, exportedAt = new Date()) {
  const lines = [headerLine(property, exportedAt)];
  for (const { stay, guest } of entries) lines.push(guestLine(stay, guest));
  return lines.join("\r\n");
}

export function unlFileName(property, exportedAt = new Date()) {
  const d = exportedAt;
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const id = clean(property.idub || "ubyport").replace(/[^A-Za-z0-9_-]/g, "");
  return `${id}_${stamp}.unl`;
}

// --- Windows-1250 encoding ------------------------------------------------

// Unicode code points for bytes 0x80–0xFF in Windows-1250 (0 = undefined).
const CP1250_HIGH = [
  0x20ac, 0, 0x201a, 0, 0x201e, 0x2026, 0x2020, 0x2021, 0, 0x2030, 0x0160, 0x2039, 0x015a, 0x0164, 0x017d, 0x0179,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0, 0x2122, 0x0161, 0x203a, 0x015b, 0x0165, 0x017e, 0x017a,
  0x00a0, 0x02c7, 0x02d8, 0x0141, 0x00a4, 0x0104, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x015e, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x017b,
  0x00b0, 0x00b1, 0x02db, 0x0142, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x0105, 0x015f, 0x00bb, 0x013d, 0x02dd, 0x013e, 0x017c,
  0x0154, 0x00c1, 0x00c2, 0x0102, 0x00c4, 0x0139, 0x0106, 0x00c7, 0x010c, 0x00c9, 0x0118, 0x00cb, 0x011a, 0x00cd, 0x00ce, 0x010e,
  0x0110, 0x0143, 0x0147, 0x00d3, 0x00d4, 0x0150, 0x00d6, 0x00d7, 0x0158, 0x016e, 0x00da, 0x0170, 0x00dc, 0x00dd, 0x0162, 0x00df,
  0x0155, 0x00e1, 0x00e2, 0x0103, 0x00e4, 0x013a, 0x0107, 0x00e7, 0x010d, 0x00e9, 0x0119, 0x00eb, 0x011b, 0x00ed, 0x00ee, 0x010f,
  0x0111, 0x0144, 0x0148, 0x00f3, 0x00f4, 0x0151, 0x00f6, 0x00f7, 0x0159, 0x016f, 0x00fa, 0x0171, 0x00fc, 0x00fd, 0x0163, 0x02d9,
];
const CP1250 = new Map(CP1250_HIGH.map((cp, i) => [cp, 0x80 + i]).filter(([cp]) => cp));

// Letters NFD can't decompose to ASCII.
const TRANSLIT = { ß: "ss", Æ: "AE", æ: "ae", Ø: "O", ø: "o", Œ: "OE", œ: "oe", Ð: "D", ð: "d", Þ: "TH", þ: "th", ı: "i", Ł: "L", ł: "l" };

function encodeChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return [cp];
  if (CP1250.has(cp)) return [CP1250.get(cp)];
  if (TRANSLIT[ch]) return [...TRANSLIT[ch]].map((c) => c.charCodeAt(0));
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (base && base !== ch) return [...base].flatMap(encodeChar);
  return [0x3f]; // "?"
}

// Returns { bytes, lossy } where lossy lists characters that had no cp1250 form.
export function encodeCp1250(text) {
  const bytes = [];
  const lossy = new Set();
  for (const ch of text) {
    const encoded = encodeChar(ch);
    if (encoded.length === 1 && encoded[0] === 0x3f && ch !== "?") lossy.add(ch);
    bytes.push(...encoded);
  }
  return { bytes: Uint8Array.from(bytes), lossy: [...lossy] };
}
