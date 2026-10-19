"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  removeEvidence,
  saveElementScore,
  startAssessment,
  submitAssessment,
  type EvidenceKind,
} from "@/modules/assessments/service";

// New assessments always belong to the active facility from the session. For the others the
// service checks the caller's right to the assessment's own facility and department.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

const refresh = () => revalidatePath("/[locale]/assessments", "layout");

export async function startAssessmentAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  let id: string;
  try {
    id = await startAssessment(ctx.access, ctx.facilityId, {
      frameworkId: text(form, "frameworkId"),
      departmentId: text(form, "departmentId"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return redirect({ href: `/assessments/${id}`, locale });
}

export async function saveScoreAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  const kind = text(form, "evidenceKind");
  try {
    await saveElementScore(ctx.access, text(form, "assessmentId"), text(form, "elementId"), {
      levelCode: text(form, "levelCode"),
      comment: text(form, "comment"),
      evidence: kind
        ? {
            kind: kind as EvidenceKind,
            note: text(form, "evidenceNote"),
            url: text(form, "evidenceUrl"),
          }
        : null,
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function removeEvidenceAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await removeEvidence(ctx.access, text(form, "evidenceId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function submitAssessmentAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await submitAssessment(ctx.access, text(form, "assessmentId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]", "layout");
  return { status: "done" };
}
