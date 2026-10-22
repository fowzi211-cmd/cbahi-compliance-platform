// The facility types, the same codes as the facility_type catalogue (seeded by the M4
// migration; Facility.type has a foreign key to it). The type decides which frameworks are
// suggested and which elements apply.
export const facilityTypes = [
  "hospital",
  "polyclinic",
  "primary_care",
  "dental",
  "laboratory",
  "home_care",
  "seasonal_hospital",
  "other",
] as const;
export type FacilityType = (typeof facilityTypes)[number];
