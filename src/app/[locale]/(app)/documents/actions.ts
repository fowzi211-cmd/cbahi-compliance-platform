"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  createDocument,
  decideVersion,
  retireDocument,
  setElementLink,
  uploadVersion,
  type DocumentType,
} from "@/modules/documents/service";

// New documents always belong to the active facility from the session. For everything else
// the service checks the caller's right to the document's own facility and department.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

async function fileFrom(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) return { name: "", bytes: new Uint8Array() };
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function versionFields(form: FormData) {
  return {
    file: await fileFrom(form),
    effectiveOn: text(form, "effectiveOn"),
    reviewOn: text(form, "reviewOn"),
    expiresOn: text(form, "expiresOn"),
    changeNote: text(form, "changeNote"),
    phiAttested: form.get("phiAttested") === "true",
    phiConfirmed: form.get("phiConfirmed") === "true",
  };
}

const refresh = () => revalidatePath("/[locale]/documents", "layout");

export async function createDocumentAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  let documentId: string;
  try {
    ({ documentId } = await createDocument(ctx.access, ctx.facilityId, {
      ...(await versionFields(form)),
      type: text(form, "type") as DocumentType,
      titleAr: text(form, "titleAr"),
      titleEn: text(form, "titleEn"),
      departmentId: text(form, "departmentId"),
    }));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return redirect({ href: `/documents/${documentId}`, locale });
}

export async function uploadVersionAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await uploadVersion(ctx.access, text(form, "documentId"), await versionFields(form));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function decideVersionAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await decideVersion(ctx.access, text(form, "versionId"), {
      decision: text(form, "decision") as "approved",
      comment: text(form, "comment"),
    });
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function setElementLinkAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await setElementLink(
      ctx.access,
      text(form, "documentId"),
      text(form, "elementId"),
      text(form, "linked") === "true",
    );
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function retireDocumentAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  try {
    await retireDocument(ctx.access, text(form, "documentId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}
