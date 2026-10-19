import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  enforceAbsoluteSessionLimit,
  getUserProfile,
  mfaRequired,
  type UserProfile,
} from "@/modules/identity/service";
import { listUserMemberships, type AccessContext } from "@/modules/tenancy/service";
import { auth } from "./auth";

// Request-level helpers for pages and server actions: who is signed in, and in which
// facility they are working. Authorization itself stays in the services (`can()`).

export const ACTIVE_FACILITY_COOKIE = "mustamir_facility";

/** The signed-in session for this request, or null. Cached per request. */
export const getSession = cache(async () => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  if (await enforceAbsoluteSessionLimit(session.session)) return null;
  return session;
});

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(locale: Locale, next?: string): Promise<UserProfile> {
  const session = await getSession();
  const profile = session ? await getUserProfile(session.user.id) : null;
  if (!profile) {
    const query = next ? `?next=${encodeURIComponent(next)}` : "";
    return redirect({ href: `/sign-in${query}`, locale });
  }
  return profile;
}

export type FacilityOption = {
  tenantId: string;
  facilityId: string;
  nameAr: string;
  nameEn: string;
};

export type AppContext = {
  user: UserProfile;
  access: AccessContext;
  facilityId: string;
  facilities: FacilityOption[];
};

/**
 * Everything an app page needs: the user, the facility they are working in and their access
 * there. People without a facility go to setup; people whose role needs a second factor go
 * to MFA enrolment before they can see anything.
 */
export const requireAppContext = cache(async (locale: Locale): Promise<AppContext> => {
  const user = await requireUser(locale);
  const memberships = await listUserMemberships(user.id);
  if (memberships.length === 0) return redirect({ href: "/setup", locale });
  if (!user.twoFactorEnabled && (await mfaRequired(user))) {
    return redirect({ href: "/mfa", locale });
  }

  const facilities = [
    ...new Map(
      memberships.map((m) => [
        m.facilityId,
        {
          tenantId: m.tenantId,
          facilityId: m.facilityId,
          nameAr: m.facilityNameAr,
          nameEn: m.facilityNameEn,
        },
      ]),
    ).values(),
  ];
  const chosen = (await cookies()).get(ACTIVE_FACILITY_COOKIE)?.value;
  const active = facilities.find((f) => f.facilityId === chosen) ?? facilities[0]!;
  const inTenant = memberships.filter((m) => m.tenantId === active.tenantId);

  return {
    user,
    facilityId: active.facilityId,
    facilities,
    access: {
      tenantId: active.tenantId,
      userId: user.id,
      actor: {
        userId: user.id,
        memberships: inTenant.map(({ facilityId, departmentId, role }) => ({
          facilityId,
          departmentId,
          role,
        })),
        consultantFacilityIds: [],
      },
    },
  };
});

/**
 * The platform admin, for the /platform pages. Anyone else gets a plain 404, so the pages do
 * not reveal that they exist. MFA is required for this role (ARCHITECTURE §6).
 */
export const requirePlatformAdmin = cache(async (locale: Locale): Promise<UserProfile> => {
  const user = await requireUser(locale);
  if (!user.isPlatformAdmin) notFound();
  if (!user.twoFactorEnabled) return redirect({ href: "/mfa", locale });
  return user;
});
