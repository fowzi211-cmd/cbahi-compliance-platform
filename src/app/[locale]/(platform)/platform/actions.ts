"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import { requirePlatformAdmin } from "@/lib/session";
import {
  actOnRequestAsPlatform,
  assignConsultant,
  endConsultantAssignment,
  features,
  platformRequestActions,
  setConsultant,
  updateSubscription,
  type PlatformActor,
} from "@/modules/subscriptions/service";

// Tiers, consultants and the request queue (M14). Each action comes back to the page it was
// sent from, with `?error=<code>` or `?done=1`, so the pages need no client code.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function change(back: string, run: (actor: PlatformActor) => Promise<unknown>) {
  const locale = (await getLocale()) as Locale;
  const user = await requirePlatformAdmin(locale);
  let target = `${back}?done=1`;
  try {
    await run({ userId: user.id, isPlatformAdmin: user.isPlatformAdmin });
  } catch (error) {
    target = `${back}?error=${encodeURIComponent(formErrorCode(error))}`;
  }
  revalidatePath("/[locale]/platform", "layout");
  revalidatePath("/[locale]", "layout");
  redirect({ href: target, locale });
}

const uuid = (form: FormData, name: string) => {
  const parsed = z.uuid().safeParse(form.get(name));
  return parsed.success ? parsed.data : "";
};

export async function updateSubscriptionAction(form: FormData) {
  const tenantId = uuid(form, "tenantId");
  await change(`/platform/tenants/${tenantId}`, (actor) =>
    updateSubscription(actor, tenantId, {
      tier: text(form, "tier") as "platform" | "hybrid",
      startsOn: text(form, "startsOn"),
      endsOn: text(form, "endsOn"),
      overrides: Object.fromEntries(
        features.map((f) => [f, text(form, `feature-${f}`) as "tier" | "on" | "off"]),
      ),
    }),
  );
}

export async function assignConsultantAction(form: FormData) {
  const tenantId = uuid(form, "tenantId");
  await change(`/platform/tenants/${tenantId}`, (actor) =>
    assignConsultant(actor, tenantId, uuid(form, "facilityId"), uuid(form, "userId")),
  );
}

export async function endAssignmentAction(form: FormData) {
  const tenantId = uuid(form, "tenantId");
  await change(`/platform/tenants/${tenantId}`, (actor) =>
    endConsultantAssignment(actor, tenantId, uuid(form, "assignmentId")),
  );
}

export async function setConsultantAction(form: FormData) {
  await change("/platform/consultants", (actor) =>
    setConsultant(actor, text(form, "email"), text(form, "grant") !== "false"),
  );
}

export async function requestAction(form: FormData) {
  const action = z.enum(platformRequestActions).safeParse(form.get("action"));
  await change("/platform/requests", async (actor) => {
    if (!action.success) throw action.error;
    await actOnRequestAsPlatform(
      actor,
      uuid(form, "requestId"),
      action.data,
      text(form, "platformNote"),
    );
  });
}
