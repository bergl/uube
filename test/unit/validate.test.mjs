import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDigit } from "../../src/mrz.js";
import { migrate, validateBackup } from "../../src/store.js";
import { guestFingerprint, guestIssues, isRealDate, mrzState, propertyIssues, stayFingerprint, stayIssues, stayStage } from "../../src/validate.js";

const TODAY = "2026-10-21";
const property = { id: "p1", label: "Vinohrady", idub: "123456789", name: "Jana", street: "Mánesova", houseNumber: "1234", municipality: "Praha", zip: "12000" };

function td3(doc, dob, nat = "D<<") {
  const l1 = "P<D<<MUELLER<<HANS".padEnd(44, "<");
  let l2 = doc + checkDigit(doc) + nat + dob + checkDigit(dob) + "M" + "310101" + checkDigit("310101") + "<".repeat(15);
  l2 += checkDigit(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43));
  return [l1, l2];
}

const guest = (over = {}) => ({
  id: "g1", surname: "Müller", givenNames: "Hans", birthDate: "1985-03-14", nationality: "DEU", documentNumber: "C01X00T47",
  address: "Berlin", visa: "", purpose: "10", note: "", mrzLines: td3("C01X00T47", "850314"), ...over,
});
const stay = (guests, over = {}) => ({ id: "s1", propertyId: "p1", arrival: "2026-10-21", departure: "2026-10-24", guests, ...over });

test("real calendar dates only", () => {
  assert.equal(isRealDate("2026-02-28"), true);
  assert.equal(isRealDate("2026-02-31"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("26-01-01"), false);
});

test("passport code is re-checked after a hand edit", () => {
  assert.equal(mrzState(guest()).state, "ok");
  const edited = guest({ documentNumber: "C01X00T48" });
  assert.equal(mrzState(edited).state, "edited");
  assert.deepEqual(mrzState(edited).fields, ["documentNumber"]);
  assert.ok(guestIssues(edited, stay([edited]), TODAY).some((i) => i.code === "mrzEdited" && i.field === "documentNumber"));
  assert.equal(mrzState(guest({ mrzLines: [] })).state, "none");
});

test("a failed check digit points at the field", () => {
  const lines = td3("C01X00T47", "850314");
  lines[1] = lines[1].slice(0, 13) + "850315" + lines[1].slice(19); // birth date misread, check digit no longer matches
  const s = mrzState(guest({ mrzLines: lines }));
  assert.equal(s.state, "failed");
  assert.ok(s.fields.includes("birthDate"));
});

test("characters Ubyport can't take are flagged before export", () => {
  const g = guest({ surname: "李" });
  assert.ok(guestIssues(g, stay([g]), TODAY).some((i) => i.code === "lossy" && i.field === "surname"));
});

test("workflow stages follow review, export and report", () => {
  const g = guest();
  const s = stay([g]);
  assert.equal(stayStage(s, property, TODAY), "review");
  assert.ok(stayIssues(s, property, TODAY).some((i) => i.code === "unreviewed"));

  g.reviewedFp = guestFingerprint(g);
  assert.equal(stayStage(s, property, TODAY), "ready");

  s.export = { at: "x", fp: stayFingerprint(s, property) };
  assert.equal(stayStage(s, property, TODAY), "exported");

  g.address = "Munich"; // changed after export; also un-reviews the guest
  assert.equal(stayStage(s, property, TODAY), "changed");
  g.reviewedFp = guestFingerprint(g);
  assert.equal(stayStage(s, property, TODAY), "changed");

  s.export = { at: "y", fp: stayFingerprint(s, property) };
  s.report = { at: "y", fp: stayFingerprint(s, property), method: "file" };
  assert.equal(stayStage(s, property, TODAY), "reported");
  s.departure = "2026-10-25";
  assert.equal(stayStage(s, property, TODAY), "changedAfterReport");

  property.zip = "12000x";
  assert.ok(propertyIssues(property).some((i) => i.code === "pZipFormat"));
  property.zip = "12000";
});

test("incomplete guests block export as draft", () => {
  const s = stay([guest({ address: "" })]);
  assert.equal(stayStage(s, property, TODAY), "draft");
  assert.ok(stayIssues(s, property, TODAY).some((i) => i.code === "badGuests"));
});

test("old data migrates to export/report stamps", () => {
  const old = { settings: {}, properties: [property], stays: [{ ...stay([guest()]), exportedAt: "2026-10-01T10:00:00Z", submittedAt: "2026-10-01T11:00:00Z" }] };
  const m = migrate(old);
  assert.equal(m.version, 2);
  assert.equal(stayStage(m.stays[0], m.properties[0], TODAY), "reported");
});

test("backups are validated before restoring", () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ stays: "x", properties: [] }).error, "notBackup");
  assert.equal(validateBackup({ version: 99, stays: [], properties: [] }).error, "newerVersion");
  assert.equal(validateBackup({ stays: [{ id: "s", guests: "nope" }], properties: [] }).error, "corrupt");
  const ok = validateBackup({ exportedAt: "2026-10-20T08:00:00Z", properties: [property], stays: [stay([guest({ birthDate: "2026-02-31" })])] });
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok.summary }, { apartments: 1, stays: 1, guests: 1, createdAt: "2026-10-20T08:00:00Z", orphans: 0 });
  assert.equal(ok.data.stays[0].guests[0].birthDate, ""); // impossible date dropped, so the guest shows as incomplete
});
