import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUnl, encodeCp1250, guestLine } from "../../src/unl.js";
import { parseMrz } from "../../src/mrz.js";
import { reportDeadline } from "../../src/deadline.js";

test("UNL output matches the reference library's fixture", () => {
  const property = {
    idub: "id1", abbr: "abbr1", name: "Ubyt", contact: "Kontakt", district: "Okr", municipality: "Obc",
    municipalityPart: "Cast", street: "Ulice", houseNumber: "2A", orientationNumber: "id1", zip: "11150",
  };
  const stay = { arrival: "2018-06-27", departure: "2018-06-30" };
  const guest = {
    surname: "Příjmení", givenNames: "Jmeno", birthDate: "1980-05-12", nationality: "SVK",
    address: "Bydl", documentNumber: "AK47", visa: "V123", purpose: "10", note: "Pozn",
  };
  const text = buildUnl(property, [{ stay, guest }], new Date(2018, 5, 27, 22, 57, 0));
  assert.equal(
    text,
    "A|2|id1|abbr1|Ubyt|Kontakt|Okr|Obc|Cast|Ulice|2A|id1|11150|27.06.2018 22:57:00||\r\n" +
      "U|27.06.2018|30.06.2018|Příjmení|Jmeno||12.05.1980|||SVK|Bydl|AK47|V123|10||Pozn",
  );
  const { bytes, lossy } = encodeCp1250(text);
  assert.deepEqual(lossy, []);
  // "Př" -> 0x50 0xF8 in Windows-1250, as in the fixture file
  const i = text.indexOf("Př");
  assert.deepEqual([...bytes.slice(i, i + 2)], [0x50, 0xf8]);
});

test("separators and newlines are stripped from fields", () => {
  const line = guestLine(
    { arrival: "2026-10-21", departure: "2026-10-24" },
    { surname: "A|B", givenNames: "C\nD", birthDate: "1990-01-02", nationality: "DEU", address: "x", documentNumber: "123" },
  );
  assert.equal(line, "U|21.10.2026|24.10.2026|A B|C D||02.01.1990|||DEU|x|123||10||");
});

test("characters outside Windows-1250 are transliterated", () => {
  const { bytes, lossy } = encodeCp1250("Øyvind Straße Ñ 李");
  assert.equal(new TextDecoder("latin1").decode(bytes), "Oyvind Straße N ?");
  assert.deepEqual(lossy, ["李"]);
});

test("TD3 passport MRZ (ICAO specimen)", () => {
  const r = parseMrz([
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
  ]);
  assert.equal(r.valid, true);
  assert.equal(r.surname, "ERIKSSON");
  assert.equal(r.givenNames, "ANNA MARIA");
  assert.equal(r.documentNumber, "L898902C3");
  assert.equal(r.birthDate, "1974-08-12");
  assert.equal(r.nationality, "UTO");
});

test("TD3 misread digit fails the check", () => {
  const r = parseMrz([
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408132F1204159ZE184226B<<<<<10",
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.checks.birthDate, false);
});

test("TD1 ID card MRZ (ICAO specimen) and German D code", () => {
  const r = parseMrz(["I<UTOD231458907<<<<<<<<<<<<<<<", "7408122F1204159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"]);
  assert.equal(r.valid, true);
  assert.equal(r.documentNumber, "D23145890");
  const de = parseMrz(["P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<", "C01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4"]);
  assert.equal(de.nationality, "DEU");
});

test("deadline is 3 working days after arrival, skipping weekends and holidays", () => {
  assert.equal(reportDeadline("2026-10-21"), "2026-10-26"); // Wed -> Thu, Fri, (28 Oct holiday is later) Mon
  assert.equal(reportDeadline("2026-10-26"), "2026-10-30"); // Mon -> Tue, (Wed 28 holiday), Thu, Fri
  assert.equal(reportDeadline("2026-12-23"), "2026-12-30"); // 24–26 Dec holidays
});
