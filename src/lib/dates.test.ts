import { describe, expect, it } from "vitest";
import { daysBetween, formatDate, formatGregorian, formatHijri, toRiyadhDay } from "./dates";

describe("formatGregorian", () => {
  const date = new Date("2026-10-19T12:00:00Z");

  it("uses the Gregorian calendar with Latin digits in Arabic", () => {
    expect(formatGregorian(date, "ar")).toBe("19 أكتوبر 2026");
  });

  it("formats English dates day-first", () => {
    expect(formatGregorian(date, "en")).toBe("19 October 2026");
  });

  it("shows the Saudi calendar day, not the UTC day", () => {
    // 22:30 UTC on 18 Oct is 01:30 on 19 Oct in Riyadh.
    expect(formatGregorian(new Date("2026-10-18T22:30:00Z"), "en")).toBe("19 October 2026");
  });
});

describe("formatHijri", () => {
  it("uses the Umm al-Qura calendar", () => {
    // 1 Ramadan 1447 AH fell on 18 February 2026 (Umm al-Qura).
    const date = new Date("2026-02-18T09:00:00Z");
    expect(formatHijri(date, "en")).toBe("Ramadan 1, 1447 AH");
    expect(formatHijri(date, "ar")).toBe("1 رمضان 1447 هـ");
  });
});

describe("formatDate", () => {
  const date = new Date("2026-02-18T09:00:00Z");

  it("shows only the Gregorian date by default", () => {
    expect(formatDate(date, "en")).toBe("18 February 2026");
  });

  it("adds the Hijri date when asked", () => {
    expect(formatDate(date, "en", { showHijri: true })).toBe(
      "18 February 2026 (Ramadan 1, 1447 AH)",
    );
  });
});

describe("toRiyadhDay", () => {
  it.each([
    ["2026-10-18T20:59:59Z", "2026-10-18"],
    ["2026-10-18T21:00:00Z", "2026-10-19"],
    ["2026-12-31T21:30:00Z", "2027-01-01"],
  ])("%s is %s in Riyadh", (iso, day) => {
    expect(toRiyadhDay(new Date(iso))).toBe(day);
  });
});

describe("daysBetween", () => {
  it("counts calendar days in Saudi time", () => {
    // Both instants are on 19 Oct in Riyadh even though the UTC days differ.
    expect(daysBetween(new Date("2026-10-18T22:00:00Z"), new Date("2026-10-19T20:00:00Z"))).toBe(0);
    expect(daysBetween(new Date("2026-10-19T08:00:00Z"), new Date("2027-01-17T08:00:00Z"))).toBe(
      90,
    );
  });

  it("is negative for a past date", () => {
    expect(daysBetween(new Date("2026-10-19T08:00:00Z"), new Date("2026-10-12T08:00:00Z"))).toBe(
      -7,
    );
  });
});
