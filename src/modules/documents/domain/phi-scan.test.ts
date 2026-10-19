import { describe, expect, it } from "vitest";
import { normalizeDigits, scanForPhi } from "./phi-scan";

// Every identifier below is invented for the test; none belongs to a real person.
describe("scanForPhi", () => {
  it.each([
    ["a national ID", "Holder 1023456789 signed.", [{ kind: "nationalId", count: 1 }]],
    ["an Iqama number", "إقامة: 2198765432", [{ kind: "nationalId", count: 1 }]],
    ["Arabic-Indic digits", "الهوية ١٠٢٣٤٥٦٧٨٩", [{ kind: "nationalId", count: 1 }]],
    ["two IDs", "1023456789 and 2023456789", [{ kind: "nationalId", count: 2 }]],
    ["an MRN", "MRN: 556677", [{ kind: "medicalRecordNumber", count: 1 }]],
    [
      "a medical record number",
      "Medical record number 12345",
      [{ kind: "medicalRecordNumber", count: 1 }],
    ],
    [
      "an Arabic file number",
      "رقم الملف الطبي: 778899",
      [{ kind: "medicalRecordNumber", count: 1 }],
    ],
    ["a patient number", "Patient ID #4455", [{ kind: "medicalRecordNumber", count: 1 }]],
    ["a date of birth", "DOB: 12/03/1985", [{ kind: "dateOfBirth", count: 1 }]],
    ["an Arabic date of birth", "تاريخ الميلاد ١٤٠٥/٠٢/١٠", [{ kind: "dateOfBirth", count: 1 }]],
    [
      "several kinds",
      "Name: Demo, DOB 1990-01-01, MRN 123456, ID 1098765432",
      [
        { kind: "nationalId", count: 1 },
        { kind: "medicalRecordNumber", count: 1 },
        { kind: "dateOfBirth", count: 1 },
      ],
    ],
  ])("finds %s", (_, text, expected) => {
    expect(scanForPhi(text)).toEqual(expected);
  });

  it.each([
    ["policy text", "All medication fridges are checked twice daily and logged."],
    ["a phone number", "Call extension 0112345678 for pharmacy."],
    ["an 11-digit number", "Reference 10234567891."],
    ["a 10-digit number starting with 3", "Batch 3023456789."],
    ["a label without a number", "Record the MRN on the form."],
    ["a review date", "Review date: 2027-01-01. Effective 2026-01-01."],
    ["a date-of-birth field left blank", "Date of birth: ________"],
    ["empty text", ""],
  ])("passes %s", (_, text) => {
    expect(scanForPhi(text)).toEqual([]);
  });
});

describe("normalizeDigits", () => {
  it("turns Arabic-Indic and Persian digits into Latin ones", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc")).toBe("0123456789 0123456789 abc");
  });
});
