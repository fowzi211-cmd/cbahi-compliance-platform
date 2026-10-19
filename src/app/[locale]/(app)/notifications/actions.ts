"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  markAllNotificationsRead,
  openNotification,
  savePreferences,
} from "@/modules/notifications/service";

// Every action works on the caller's own notices and settings only.

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

// The bell's count lives in the app layout.
const refresh = () => revalidatePath("/[locale]", "layout");

export async function openNotificationAction(form: FormData) {
  const { locale, ctx } = await context();
  const href = await openNotification(ctx.access, String(form.get("id") ?? ""));
  refresh();
  redirect({ href: href ?? "/notifications", locale });
}

export async function markAllReadAction() {
  const { ctx } = await context();
  await markAllNotificationsRead(ctx.access);
  refresh();
}

export async function savePreferencesAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await savePreferences(ctx.access, {
      emailImmediate: form.get("emailImmediate") === "on",
      emailDigest: form.get("emailDigest") === "on",
      locale: String(form.get("locale") ?? "") as "ar",
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  return { status: "done" };
}
