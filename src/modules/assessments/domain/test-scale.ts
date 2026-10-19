import type { Scale } from "./scale";

// The default four-level scale (the library's defaultScale), for tests.
export const testScale: Scale = [
  {
    code: "MET",
    value: 1,
    countsInDenominator: true,
    requiresEvidence: true,
    generatesFinding: false,
  },
  {
    code: "PM",
    value: 0.5,
    countsInDenominator: true,
    requiresEvidence: true,
    generatesFinding: true,
  },
  {
    code: "NM",
    value: 0,
    countsInDenominator: true,
    requiresEvidence: false,
    generatesFinding: true,
  },
  {
    code: "NA",
    value: 0,
    countsInDenominator: false,
    requiresEvidence: false,
    generatesFinding: false,
  },
];
