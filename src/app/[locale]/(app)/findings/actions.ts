"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  addCapaEvidence,
  createCapaItem,
  removeCapaEvidence,
  rescheduleCapaItem,
  transitionCapaItem,
  type CapaEvidenceKind,
  type CapaTransition,
} from "@/modules/findings/service";

// The service checks the caller's right to the finding's facility and department, and to
// the action itself; nothing here trusts the ids in the form.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return requireAppContext(locale);
}

const refresh = () => revalidatePath("/[locale]/findings", "layout");

async function run(work: () => Promise<unknown>): Promise<FormState> {
  try {
    await work();
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function createCapaAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return run(() =>
    createCapaItem(ctx.access, text(form, "findingId"), {
      action: text(form, "action"),
      ownerUserId: text(form, "ownerUserId"),
      dueOn: text(form, "dueOn"),
    }),
  );
}

export async function transitionCapaAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return run(() =>
    transitionCapaItem(ctx.access, text(form, "itemId"), {
      transition: text(form, "transition") as CapaTransition,
      note: text(form, "note"),
    }),
  );
}

export async function rescheduleCapaAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return run(() =>
    rescheduleCapaItem(ctx.access, text(form, "itemId"), {
      dueOn: text(form, "dueOn"),
      reason: text(form, "reason"),
    }),
  );
}

export async function addEvidenceAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return run(() =>
    addCapaEvidence(ctx.access, text(form, "itemId"), {
      kind: text(form, "kind") as CapaEvidenceKind,
      documentVersionId: text(form, "documentVersionId"),
      url: text(form, "url"),
      description: text(form, "description"),
    }),
  );
}

export async function removeEvidenceAction(_: FormState, form: FormData): Promise<FormState> {
  const ctx = await context();
  return run(() => removeCapaEvidence(ctx.access, text(form, "evidenceId")));
}
