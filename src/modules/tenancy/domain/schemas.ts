import { z } from "zod";
import { facilityTypes } from "./facility-types";

const name = z.string().trim().min(1).max(200);

export const membershipRoles = [
  "facility_owner",
  "quality_manager",
  "department_head",
  "staff",
  "viewer",
] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const tiers = ["platform", "hybrid"] as const;
export type Tier = (typeof tiers)[number];

export const createTenantInput = z.object({
  name,
  tier: z.enum(tiers).default("platform"),
  owner: z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    name,
  }),
  facility: z.object({
    nameAr: name,
    nameEn: name,
    type: z.enum(facilityTypes),
  }),
});
export type CreateTenantInput = z.input<typeof createTenantInput>;

// Empty optional fields arrive from forms as "", which means "not given".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const facilityInput = z.object({
  nameAr: name,
  nameEn: name,
  type: z.enum(facilityTypes),
  licenseNo: optionalText(50),
  city: optionalText(100),
});
export type FacilityInput = z.input<typeof facilityInput>;

export const departmentInput = z.object({
  facilityId: z.uuid(),
  nameAr: name,
  nameEn: name,
  // A code from the department_type catalogue (checked by the service).
  typeCode: optionalText(50),
});
export type DepartmentInput = z.input<typeof departmentInput>;

export const membershipInput = z
  .object({
    userId: z.uuid(),
    facilityId: z.uuid(),
    departmentId: z.uuid().optional(),
    role: z.enum(membershipRoles),
  })
  .refine((m) => m.role !== "department_head" || m.departmentId, {
    message: "A department head must be assigned to a department",
    path: ["departmentId"],
  });
export type MembershipInput = z.input<typeof membershipInput>;
