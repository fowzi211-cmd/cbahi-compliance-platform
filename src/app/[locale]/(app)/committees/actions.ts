"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import type { FormState } from "@/lib/form-state";
import { requireAppContext } from "@/lib/session";
import {
  archiveCommittee,
  createCommittee,
  deleteMeeting,
  fileMinutes,
  recordMeeting,
  setCommitteeElement,
  updateCommittee,
  type CommitteeFrequency,
} from "@/modules/committees/service";

// New committees belong to the active facility from the session. For the rest the service
// checks the caller's right to the committee's own facility.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function context() {
  const locale = (await getLocale()) as Locale;
  return { locale, ctx: await requireAppContext(locale) };
}

const committeeFields = (form: FormData) => ({
  nameAr: text(form, "nameAr"),
  nameEn: text(form, "nameEn"),
  frequency: text(form, "frequency") as CommitteeFrequency,
  chairUserId: text(form, "chairUserId"),
});

// Minutes are documents too, so the documents screens are refreshed with the committees.
const refresh = () => {
  revalidatePath("/[locale]/committees", "layout");
  revalidatePath("/[locale]/documents", "layout");
};

async function attempt(work: () => Promise<unknown>): Promise<FormState> {
  try {
    await work();
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return { status: "done" };
}

export async function createCommitteeAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  let committeeId: string;
  try {
    committeeId = await createCommittee(ctx.access, ctx.facilityId, committeeFields(form));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return redirect({ href: `/committees/${committeeId}`, locale });
}

export async function updateCommitteeAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  return attempt(() =>
    updateCommittee(ctx.access, text(form, "committeeId"), committeeFields(form)),
  );
}

export async function archiveCommitteeAction(_: FormState, form: FormData): Promise<FormState> {
  const { locale, ctx } = await context();
  try {
    await archiveCommittee(ctx.access, text(form, "committeeId"));
  } catch (error) {
    return { status: "error", error: formErrorCode(error) };
  }
  refresh();
  return redirect({ href: "/committees", locale });
}

export async function setCommitteeElementAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  return attempt(() =>
    setCommitteeElement(
      ctx.access,
      text(form, "committeeId"),
      text(form, "elementId"),
      text(form, "linked") === "true",
    ),
  );
}

export async function recordMeetingAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  return attempt(() =>
    recordMeeting(ctx.access, text(form, "committeeId"), { heldOn: text(form, "heldOn") }),
  );
}

export async function deleteMeetingAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  return attempt(() => deleteMeeting(ctx.access, text(form, "meetingId")));
}

export async function fileMinutesAction(_: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await context();
  const file = form.get("file");
  return attempt(async () =>
    fileMinutes(ctx.access, text(form, "meetingId"), {
      titleAr: text(form, "titleAr"),
      titleEn: text(form, "titleEn"),
      file:
        file instanceof File
          ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
          : { name: "", bytes: new Uint8Array() },
      phiAttested: form.get("phiAttested") === "true",
      phiConfirmed: form.get("phiConfirmed") === "true",
    }),
  );
}
