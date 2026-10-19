"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import { requireAppContext } from "@/lib/session";
import { inviteMember, revokeInvitation } from "@/modules/tenancy/service";
import type { FormState } from "@/modules/tenancy/ui/form-state";

const optional = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value !== "" ? value : undefined;

export async function inviteAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireAppContext((await getLocale()) as Locale);
  try {
    await inviteMember(ctx.access, {
      facilityId: String(form.get("facilityId")),
      departmentId: optional(form.get("departmentId")),
      email: String(form.get("email") ?? ""),
      role: String(form.get("role")) as never,
      locale: String(form.get("locale")) as never,
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]/people", "page");
  // The onboarding wizard's people step lists invitations too.
  revalidatePath("/[locale]/onboarding/[step]", "page");
  return { status: "done" };
}

export async function revokeInvitationAction(form: FormData) {
  const ctx = await requireAppContext((await getLocale()) as Locale);
  const id = z.uuid().safeParse(form.get("invitationId"));
  if (id.success) await revokeInvitation(ctx.access, id.data);
  revalidatePath("/[locale]/people", "page");
}
