import Anthropic from "@anthropic-ai/sdk";
import { normalizeCountry, parseMrz } from "./mrz.js";

const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    surname: { type: "string", description: "Surname(s) in Latin script, as printed in the visual zone (keep diacritics)." },
    given_names: { type: "string", description: "Given name(s) in Latin script, as printed (keep diacritics)." },
    date_of_birth: { type: "string", description: "YYYY-MM-DD, or empty if unreadable." },
    sex: { type: "string", enum: ["M", "F", "X", ""] },
    nationality: { type: "string", description: "ISO 3166-1 alpha-3 code of the holder's nationality, e.g. DEU, USA, GBR." },
    document_type: { type: "string", enum: ["passport", "id_card", "residence_permit", "visa", "other"] },
    document_number: { type: "string", description: "Document number exactly as printed, without spaces." },
    issuing_country: { type: "string", description: "ISO 3166-1 alpha-3 code of the issuing state." },
    expiry_date: { type: "string", description: "YYYY-MM-DD, or empty." },
    mrz_lines: {
      type: "array",
      items: { type: "string" },
      description: "The machine-readable zone lines exactly as printed, using '<' for fillers. Empty if not visible.",
    },
    image_indexes: { type: "array", items: { type: "integer" }, description: "Which input images (1-based) show this document." },
    problems: { type: "string", description: "Anything unreadable, cut off, blurry or uncertain. Empty if all clear." },
  },
  required: [
    "surname", "given_names", "date_of_birth", "sex", "nationality", "document_type",
    "document_number", "issuing_country", "expiry_date", "mrz_lines", "image_indexes", "problems",
  ],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    documents: { type: "array", items: DOCUMENT_SCHEMA },
    unusable_images: {
      type: "array",
      items: { type: "string" },
      description: "One short note per image that shows no identity document, e.g. '3: not a document'.",
    },
  },
  required: ["documents", "unusable_images"],
  additionalProperties: false,
};

const SYSTEM = `You read identity documents (passports, national ID cards) from photos so an accommodation host in Prague can register foreign guests with the Czech police (Ubyport), as Czech law requires.

Return one entry per distinct person/document. Photos of the front and back of the same ID card are one document: merge them and list both image indexes. A single photo may show several documents.

Transcribe; never guess. If a character is unreadable, leave the field empty or keep what is legible and describe it in "problems". Copy the MRZ lines character for character — they are used to verify check digits. Use the Latin-script name from the visual zone (with diacritics, e.g. "Müller", "Nováková"); if the visual zone has only non-Latin script, use the MRZ transliteration.`;

// Scale big phone photos down so requests stay small and fast; MRZ text stays legible at 2000px.
// rotation is in quarter turns clockwise, as chosen in the photo tray.
async function toJpegBase64(file, rotation = 0, maxSide = 2000) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const turns = ((rotation % 4) + 4) % 4;
  const canvas = document.createElement("canvas");
  canvas.width = turns % 2 ? h : w;
  canvas.height = turns % 2 ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// Turns a model-read document into a guest record and cross-checks it against its MRZ.
export function toGuest(doc) {
  const guest = {
    surname: doc.surname.trim(),
    givenNames: doc.given_names.trim(),
    birthDate: doc.date_of_birth,
    sex: doc.sex,
    nationality: normalizeCountry(doc.nationality),
    documentType: doc.document_type,
    documentNumber: doc.document_number.replace(/\s+/g, "").toUpperCase(),
    issuingCountry: normalizeCountry(doc.issuing_country),
    expiryDate: doc.expiry_date,
    visa: "",
    address: "",
    purpose: "10",
    note: "",
    mrzLines: doc.mrz_lines,
    readerProblems: doc.problems,
    mrz: null,
  };

  const mrz = doc.mrz_lines.length ? parseMrz(doc.mrz_lines) : null;
  if (mrz) {
    guest.mrz = { valid: mrz.valid, checks: mrz.checks, mismatches: [] };
    // When the MRZ checks out it is the most reliable source for numbers and dates.
    for (const field of ["documentNumber", "birthDate", "nationality"]) {
      const fromMrz = mrz[field];
      const fieldValid = field === "nationality" ? mrz.valid : mrz.checks[field];
      if (fromMrz && fieldValid && fromMrz !== guest[field]) {
        guest.mrz.mismatches.push({ field, from: guest[field], to: fromMrz });
        guest[field] = fromMrz;
      }
    }
  }
  return guest;
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

// Photos per request. Smaller batches fail independently and keep earlier results;
// photos of one ID card should sit next to each other so they share a batch.
export const BATCH_SIZE = 6;

async function readBatch(client, items, offset, { model, noteLanguage, signal, onProgress, total }) {
  const content = [];
  for (const [i, item] of items.entries()) {
    onProgress?.({ phase: "prepare", i: offset + i + 1, n: total });
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toJpegBase64(item.file, item.rotation) } });
    if (signal?.aborted) throw codedError("aborted");
  }
  content.push({ type: "text", text: `Extract every identity document in these images. Write "problems" and "unusable_images" in ${noteLanguage}.` });

  const request = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
  };
  onProgress?.({ phase: "send" });
  // Server-side fallback reruns a declined request on another model (not offered for Haiku).
  const response = model.startsWith("claude-haiku")
    ? await client.messages.create(request, { signal })
    : await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal });
  onProgress?.({ phase: "check" });

  if (response.stop_reason === "refusal") throw codedError("refusal");
  if (response.stop_reason === "max_tokens") throw codedError("truncated");

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  return {
    // image_indexes are 1-based within the batch; report them as indexes into all items.
    guests: parsed.documents.map((doc) => ({ ...toGuest(doc), imageIndexes: doc.image_indexes.map((n) => offset + n - 1).filter((n) => n >= offset && n < offset + items.length) })),
    unusable: parsed.unusable_images,
  };
}

// items: [{ file, rotation }]. Reads them in batches; on failure the error carries
// the guests found so far (err.partial) so nothing already read is lost.
export async function readDocuments(items, { apiKey, model, noteLanguage = "English", signal, onProgress }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const guests = [];
  const unusable = [];
  const batches = Math.ceil(items.length / BATCH_SIZE);
  for (let b = 0; b < batches; b++) {
    onProgress?.({ phase: "batch", i: b + 1, n: batches });
    try {
      const result = await readBatch(client, items.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE), b * BATCH_SIZE, { model, noteLanguage, signal, onProgress, total: items.length });
      guests.push(...result.guests);
      unusable.push(...result.unusable);
    } catch (err) {
      const error = signal?.aborted ? codedError("aborted") : err;
      error.partial = { guests, unusable };
      throw error;
    }
  }
  return { guests, unusable };
}

// Maps a failure to a translation key ("err.*") plus a detail string.
export function apiErrorKey(err) {
  if (err?.code === "aborted" || err instanceof Anthropic.APIUserAbortError) return { key: "toast.cancelled" };
  if (err?.code === "refusal") return { key: "err.refusal" };
  if (err?.code === "truncated") return { key: "err.truncated" };
  if (err instanceof Anthropic.AuthenticationError) return { key: "err.auth" };
  if (err instanceof Anthropic.PermissionDeniedError) return { key: "err.permission" };
  if (err instanceof Anthropic.RateLimitError) return { key: "err.rate" };
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return { key: "err.credit" };
    return { key: "err.badRequest", detail: err.message };
  }
  if (err instanceof Anthropic.InternalServerError) return { key: "err.server" };
  if (err instanceof Anthropic.APIConnectionError) return { key: "err.network" };
  return { key: "err.other", detail: err?.message || String(err) };
}
