"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import { exportMockSurveyReport, startMockSurvey } from "@/modules/surveys/service";

// New surveys belong to the active facility from the session; for an existing one the
// service checks the caller's right to the survey's own facility. Scoring and locking use the
// assessment actions, as a mock survey is an assessment.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function startMockSurveyAction(_: FormState, form: FormData): Promise<FormState> {
  const locale = (await getLocale()) as Locale;
  const ctx = await requireAppContext(locale);
  let id: string;
  try {
    id = await startMockSurvey(ctx.access, ctx.facilityId, {
      frameworkId: text(form, "frameworkId"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]/mock-surveys", "layout");
  return redirect({ href: `/mock-surveys/${id}`, locale });
}

export async function exportReportAction(_: FormState, form: FormData): Promise<FormState> {
  const locale = (await getLocale()) as Locale;
  const ctx = await requireAppContext(locale);
  try {
    await exportMockSurveyReport(ctx.access, text(form, "assessmentId"), {
      phiAttested: form.get("phiAttested") === "true",
      phiConfirmed: form.get("phiConfirmed") === "true",
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]", "layout");
  return { status: "done" };
}
