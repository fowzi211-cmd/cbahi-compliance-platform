import { z } from "zod";

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
    type: z.string().trim().min(1).max(50),
  }),
});
export type CreateTenantInput = z.input<typeof createTenantInput>;

export const facilityInput = z.object({
  nameAr: name,
  nameEn: name,
  type: z.string().trim().min(1).max(50),
  licenseNo: z.string().trim().max(50).optional(),
  city: z.string().trim().max(100).optional(),
});
export type FacilityInput = z.input<typeof facilityInput>;

export const departmentInput = z.object({
  facilityId: z.uuid(),
  nameAr: name,
  nameEn: name,
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
