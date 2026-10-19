// A starter list until M5 brings the facility-type catalogue that drives which standards
// apply. Stored as plain text on Facility.type so M5 can map these values.
export const facilityTypes = [
  "hospital",
  "polyclinic",
  "primary_care",
  "dental",
  "laboratory",
  "home_care",
  "other",
] as const;
export type FacilityType = (typeof facilityTypes)[number];
