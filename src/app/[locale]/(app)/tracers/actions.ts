"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  saveElementScore,
  submitAssessment,
  type EvidenceKind,
} from "@/modules/assessments/service";
import {
  archiveTemplate,
  createTemplate,
  startRun,
  type TracerFrequency,
} from "@/modules/tracers/service";

// New templates belong to the active facility from the session. For the rest the services
// check the caller's right to the template's or run's own facility and department.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

const refresh = () => revalidatePath("/[locale]/tracers", "layout");

export async function createTemplateAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await createTemplate(ctx.access, ctx.facilityId, {
      nameAr: text(form, "nameAr"),
      nameEn: text(form, "nameEn"),
      frameworkId: text(form, "frameworkId"),
      departmentId: text(form, "departmentId"),
      chapterIds: form.getAll("chapterIds").map(String),
      sampleSize: text(form, "sampleSize"),
      frequency: text(form, "frequency") as TracerFrequency,
      assigneeUserId: text(form, "assigneeUserId"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function archiveTemplateAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await archiveTemplate(ctx.access, text(form, "templateId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function startRunAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  let runId: string;
  try {
    runId = await startRun(ctx.access, text(form, "templateId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return redirect({ href: `/tracers/runs/${runId}?step=1`, locale });
}

/**
 * Saves one element of a run and moves on. What was seen is both the comment (it becomes the
 * finding's statement for a gap) and, when given, a piece of evidence of the chosen kind.
 * Coming back to an element without writing anything keeps what was recorded before.
 */
export async function saveStepAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  const runId = text(form, "runId");
  const note = text(form, "note").trim();
  try {
    await saveElementScore(ctx.access, runId, text(form, "elementId"), {
      levelCode: text(form, "levelCode"),
      comment: note || text(form, "existingComment"),
      evidence: note ? { kind: text(form, "evidenceKind") as EvidenceKind, note } : null,
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  const step = Number(text(form, "step")) || 1;
  return redirect({ href: `/tracers/runs/${runId}?step=${step + 1}`, locale });
}

export async function submitRunAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  const runId = text(form, "runId");
  try {
    await submitAssessment(ctx.access, runId);
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]", "layout");
  return redirect({ href: `/tracers/runs/${runId}`, locale });
}
