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
async function toJpegBase64(file, maxSide = 2000) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
    const labels = { documentNumber: "document number", birthDate: "date of birth", nationality: "nationality" };
    // When the MRZ checks out it is the most reliable source for numbers and dates.
    for (const field of ["documentNumber", "birthDate", "nationality"]) {
      const fromMrz = mrz[field];
      const fieldValid = field === "nationality" ? mrz.valid : mrz.checks[field];
      if (fromMrz && fieldValid && fromMrz !== guest[field]) {
        guest.mrz.mismatches.push(`${labels[field]}: photo "${guest[field]}" → MRZ "${fromMrz}"`);
        guest[field] = fromMrz;
      }
    }
  }
  return guest;
}

export async function readDocuments(files, { apiKey, model }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  const content = [];
  for (const [i, file] of files.entries()) {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toJpegBase64(file) } });
  }
  content.push({ type: "text", text: "Extract every identity document in these images." });

  const request = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
  };
  // Server-side fallback reruns a declined request on another model (not offered for Haiku).
  const response = model.startsWith("claude-haiku")
    ? await client.messages.create(request)
    : await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to read these images. Please type the details in manually.");
  if (response.stop_reason === "max_tokens") throw new Error("The response was cut off. Try fewer photos at once.");

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  return { guests: parsed.documents.map(toGuest), unusable: parsed.unusable_images };
}

export function describeApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now — wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return "Your Anthropic account is out of credit. Top it up at console.anthropic.com.";
    return `Request rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.InternalServerError) return "Anthropic's servers had a problem. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check the internet connection.";
  return err?.message || String(err);
}
