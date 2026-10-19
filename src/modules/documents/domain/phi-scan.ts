// The PHI guard (ARCHITECTURE decision 10 and §6): documents are about how the facility
// works, never about a patient. Text extracted from an upload is scanned for the patterns
// that most often slip in by accident (a filled-in form, a sample record). The scan is a
// safety net, not a guarantee; the uploader's attestation is the primary control.
//
// Only counts per kind are returned. The matched text itself is never returned, stored or
// logged: that would copy the very data the scan is there to keep out.

export const phiKinds = ["nationalId", "medicalRecordNumber", "dateOfBirth"] as const;
export type PhiKind = (typeof phiKinds)[number];

export type PhiHit = { kind: PhiKind; count: number };

/** Arabic-Indic and Persian digits as Latin, so "١٠٢٣..." is caught like "1023...". */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const date = String.raw`\d{1,4}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{1,4}`;

const patterns: Record<PhiKind, RegExp> = {
  // Saudi national ID (starts with 1) or Iqama (starts with 2): ten digits on their own.
  nationalId: /(?<![\d])[12]\d{9}(?![\d])/g,
  // A medical-record or patient number: the label, then a number of three digits or more.
  medicalRecordNumber: new RegExp(
    String.raw`(?:\bM\.?R\.?N\b|\bmedical\s+record\s*(?:no\.?|number|#)?|\bpatient\s*(?:id|no\.?|number|#)|\bfile\s*(?:no\.?|number|#)|رقم\s+(?:الملف|السجل)(?:\s+الطبي)?|الرقم\s+الطبي|رقم\s+المريض)\s*[:#.\-]?\s*\d{3,}`,
    "giu",
  ),
  // A date of birth: the label, then a date within a few characters.
  dateOfBirth: new RegExp(
    String.raw`(?:\bD\.?O\.?B\b|\bdate\s+of\s+birth\b|\bbirth\s*date\b|تاريخ\s+(?:الميلاد|الولادة))\s*[:\-]?\s*.{0,12}?${date}`,
    "giu",
  ),
};

/** Every kind of PHI pattern found in the text, with how often. Empty when clean. */
export function scanForPhi(text: string): PhiHit[] {
  const normalized = normalizeDigits(text);
  return phiKinds.flatMap((kind) => {
    const count = normalized.match(patterns[kind])?.length ?? 0;
    return count > 0 ? [{ kind, count }] : [];
  });
}
