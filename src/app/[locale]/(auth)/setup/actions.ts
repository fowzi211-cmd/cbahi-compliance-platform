"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { formErrorCode } from "@/lib/form-errors";
import { getSession } from "@/lib/session";
import { createOrganization } from "@/modules/tenancy/service";
import type { FormState } from "@/modules/tenancy/ui/form-state";

export async function createOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  const locale = await getLocale();
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  try {
    await createOrganization(session.user, {
      organizationName: String(form.get("organizationName") ?? ""),
      facilityNameAr: String(form.get("facilityNameAr") ?? ""),
      facilityNameEn: String(form.get("facilityNameEn") ?? ""),
      facilityType: String(form.get("facilityType") ?? "") as never,
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  // On to the onboarding wizard. Owners need a second factor first (ARCHITECTURE §6); the app
  // layout sends them there before the wizard opens.
  return redirect({ href: "/onboarding", locale });
}
