"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { ACTIVE_FACILITY_COOKIE, getSession } from "@/lib/session";
import { listUserMemberships } from "@/modules/tenancy/service";

/** Remembers which facility the user is working in. Only facilities they belong to count. */
export async function switchFacility(formData: FormData) {
  const locale = await getLocale();
  const facilityId = z.uuid().safeParse(formData.get("facilityId"));
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  if (facilityId.success) {
    const memberships = await listUserMemberships(session.user.id);
    if (memberships.some((m) => m.facilityId === facilityId.data)) {
      (await cookies()).set(ACTIVE_FACILITY_COOKIE, facilityId.data, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
  }
  redirect({ href: "/", locale });
}
