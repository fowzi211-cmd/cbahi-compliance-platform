"use server";

import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { formErrorCode } from "@/lib/form-errors";
import { ACTIVE_FACILITY_COOKIE, getSession } from "@/lib/session";
import { markEmailVerified } from "@/modules/identity/service";
import { acceptInvitation } from "@/modules/tenancy/service";
import type { FormState } from "@/modules/tenancy/ui/form-state";

export async function acceptInvitationAction(_: FormState, form: FormData): Promise<FormState> {
  const locale = await getLocale();
  const session = await getSession();
  const token = z.string().min(20).max(100).safeParse(form.get("token"));
  if (!session) return redirect({ href: "/sign-in", locale });
  if (!token.success) return { status: "error", error: "notFound" };

  let facilityId: string;
  try {
    ({ facilityId } = await acceptInvitation(token.data, session.user));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  // The invitation reached this mailbox, which verifies the address.
  await markEmailVerified(session.user.id);
  (await cookies()).set(ACTIVE_FACILITY_COOKIE, facilityId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return redirect({ href: "/", locale });
}
