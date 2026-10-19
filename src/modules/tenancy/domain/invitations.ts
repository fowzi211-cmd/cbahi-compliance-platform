import { z } from "zod";
import { membershipRoles } from "./schemas";

// An invitation is a one-time link into one facility role. It expires after a week: long
// enough for someone on shifts to see the email, short enough that a forwarded or forgotten
// link does not stay a way in.
export const invitationValidityDays = 7;

export const invitationLocales = ["ar", "en"] as const;

export const inviteInput = z
  .object({
    facilityId: z.uuid(),
    departmentId: z.uuid().optional(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: z.enum(membershipRoles),
    locale: z.enum(invitationLocales).default("ar"),
  })
  .refine((m) => m.role !== "department_head" || m.departmentId, {
    message: "A department head must be assigned to a department",
    path: ["departmentId"],
  });
export type InviteInput = z.input<typeof inviteInput>;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export function invitationStatus(
  invitation: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + invitationValidityDays * 24 * 3_600_000);
}

/** The invitation is for one mailbox; whoever accepts must be signed in with that address. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const createOrganizationInput = z.object({
  organizationName: z.string().trim().min(1).max(200),
  facilityNameAr: z.string().trim().min(1).max(200),
  facilityNameEn: z.string().trim().min(1).max(200),
  facilityType: z.string().trim().min(1).max(50),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationInput>;
