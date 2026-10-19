"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import { requireAppContext } from "@/lib/session";
import { decideApplicability, setFacilityFrameworks } from "@/modules/standards/service";
import { saveSurveyCycle } from "@/modules/surveys/service";
import {
  archiveDepartment,
  completeOnboardingStep,
  createDepartment,
  isOnboardingStep,
  stepAfter,
  updateFacilityProfile,
  type OnboardingStep,
} from "@/modules/tenancy/service";
import type { FormState } from "@/lib/form-state";

// The wizard always works on the active facility from the session, never on an id posted
// by the form, so a crafted request cannot point it at another facility.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

/** Marks the step saved and moves on: to the next step, or to the summary after the last. */
async function finishStep(step: OnboardingStep): Promise<never> {
  const { locale, ctx } = await context();
  await completeOnboardingStep(ctx.access, ctx.facilityId, step);
  revalidatePath("/[locale]", "layout");
  const next = stepAfter(step);
  return redirect({ href: next ? `/onboarding/${next}` : "/onboarding", locale });
}

export async function saveFacilityAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await updateFacilityProfile(ctx.access, ctx.facilityId, {
      nameAr: text(form, "nameAr"),
      nameEn: text(form, "nameEn"),
      type: text(form, "type") as never,
      licenseNo: text(form, "licenseNo"),
      city: text(form, "city"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  return finishStep("facility");
}

export async function saveFrameworksAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await setFacilityFrameworks(ctx.access, ctx.facilityId, form.getAll("frameworkId").map(String));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  return finishStep("frameworks");
}

export async function decideApplicabilityAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await decideApplicability(ctx.access, ctx.facilityId, text(form, "elementId"), {
      applicable: text(form, "applicable") === "true",
      justification: text(form, "justification"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]/onboarding/[step]", "page");
  return { status: "done" };
}

export async function addDepartmentAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await createDepartment(ctx.access, {
      facilityId: ctx.facilityId,
      nameAr: text(form, "nameAr"),
      nameEn: text(form, "nameEn"),
      typeCode: text(form, "typeCode"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]/onboarding/[step]", "page");
  return { status: "done" };
}

export async function archiveDepartmentAction(form: FormData) {
  const { ctx } = await context();
  const id = z.uuid().safeParse(form.get("departmentId"));
  if (id.success) await archiveDepartment(ctx.access, id.data);
  revalidatePath("/[locale]/onboarding/[step]", "page");
}

export async function saveSurveyAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await saveSurveyCycle(ctx.access, ctx.facilityId, {
      status: text(form, "status") as never,
      lastSurveyOn: text(form, "lastSurveyOn"),
      nextExpectedOn: text(form, "nextExpectedOn"),
      notes: text(form, "notes"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  return finishStep("survey");
}

/** For the steps with nothing to submit as a whole (applicability, departments, people). */
export async function continueAction(form: FormData) {
  const step = text(form, "step");
  if (!isOnboardingStep(step)) return;
  await finishStep(step);
}
