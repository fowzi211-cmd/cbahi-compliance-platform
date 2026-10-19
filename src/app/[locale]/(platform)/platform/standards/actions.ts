"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import { requirePlatformAdmin } from "@/lib/session";
import {
  activateEdition,
  commitImport,
  deleteDraft,
  discardImport,
  previewImport,
  retireEdition,
  setLicenseNote,
  frameworkFormFields,
  type PlatformActor,
} from "@/modules/standards/service";
import type { ImportFormState } from "@/modules/standards/ui/import-form-state";

async function platformActor(): Promise<{ actor: PlatformActor; locale: Locale }> {
  const locale = (await getLocale()) as Locale;
  const user = await requirePlatformAdmin(locale);
  return { actor: { userId: user.id, isPlatformAdmin: user.isPlatformAdmin }, locale };
}

export async function previewImportAction(
  _: ImportFormState,
  form: FormData,
): Promise<ImportFormState> {
  const { actor, locale } = await platformActor();
  const framework: Record<string, string> = {};
  for (const field of frameworkFormFields) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim() !== "") framework[field] = value;
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "invalid", issues: [{ severity: "error", code: "emptyFile" }], framework };
  }
  let importId: string;
  try {
    const result = await previewImport(actor, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      framework,
    });
    if (!result.ok) return { status: "invalid", issues: result.issues, framework };
    importId = result.importId;
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  revalidatePath("/[locale]/platform/standards", "page");
  redirect({ href: `/platform/standards/imports/${importId}`, locale });
  return { status: "idle" };
}

const id = (form: FormData, field: string) => z.uuid().parse(form.get(field));

/** Runs an edition change and comes back to `back`, with the error code in the URL if any. */
async function change(back: string, run: (actor: PlatformActor) => Promise<string | void>) {
  const { actor, locale } = await platformActor();
  let target = back;
  try {
    target = (await run(actor)) ?? back;
  } catch (error) {
    target = `${back}?error=${encodeURIComponent(formErrorCode(error))}`;
  }
  revalidatePath("/[locale]/platform/standards", "layout");
  revalidatePath("/[locale]/standards", "layout");
  redirect({ href: target, locale });
}

export async function commitImportAction(form: FormData) {
  const importId = id(form, "importId");
  await change(`/platform/standards/imports/${importId}`, async (actor) => {
    const frameworkId = await commitImport(actor, importId);
    return `/platform/standards/${frameworkId}`;
  });
}

export async function discardImportAction(form: FormData) {
  const importId = id(form, "importId");
  await change(`/platform/standards/imports/${importId}`, async (actor) => {
    await discardImport(actor, importId);
    return "/platform/standards";
  });
}

export async function setLicenseNoteAction(form: FormData) {
  const frameworkId = id(form, "frameworkId");
  await change(`/platform/standards/${frameworkId}`, (actor) =>
    setLicenseNote(actor, frameworkId, String(form.get("licenseNote") ?? "")),
  );
}

export async function activateEditionAction(form: FormData) {
  const frameworkId = id(form, "frameworkId");
  await change(`/platform/standards/${frameworkId}`, (actor) =>
    activateEdition(actor, frameworkId),
  );
}

export async function retireEditionAction(form: FormData) {
  const frameworkId = id(form, "frameworkId");
  await change(`/platform/standards/${frameworkId}`, (actor) => retireEdition(actor, frameworkId));
}

export async function deleteDraftAction(form: FormData) {
  const frameworkId = id(form, "frameworkId");
  await change(`/platform/standards/${frameworkId}`, async (actor) => {
    await deleteDraft(actor, frameworkId);
    return "/platform/standards";
  });
}
