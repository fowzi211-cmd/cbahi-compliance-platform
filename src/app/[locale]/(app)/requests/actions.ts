"use server";

import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formErrorCode } from "@/lib/form-errors";
import { requireAppContext } from "@/lib/session";
import {
  actOnServiceRequest,
  createServiceRequest,
  facilityRequestActions,
  requestKinds,
} from "@/modules/subscriptions/service";

// Requests are sent from the active facility of the session; answering one checks the
// caller's right to the request's own facility in the service.

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function attempt(
  work: (ctx: Awaited<ReturnType<typeof requireAppContext>>) => Promise<unknown>,
) {
  const locale = (await getLocale()) as Locale;
  const ctx = await requireAppContext(locale);
  let target = "/requests?done=1";
  try {
    await work(ctx);
  } catch (error) {
    target = `/requests?error=${encodeURIComponent(formErrorCode(error))}`;
  }
  revalidatePath("/[locale]/requests", "page");
  revalidatePath("/[locale]", "page");
  redirect({ href: target, locale });
}

export async function createRequestAction(form: FormData) {
  await attempt((ctx) =>
    createServiceRequest(ctx.access, ctx.facilityId, {
      kind: text(form, "kind") as (typeof requestKinds)[number],
      note: text(form, "note"),
    }),
  );
}

export async function answerRequestAction(form: FormData) {
  const action = z.enum(facilityRequestActions).safeParse(form.get("action"));
  const kind = z.enum(requestKinds).safeParse(form.get("kind"));
  await attempt(async (ctx) => {
    if (!action.success) throw action.error;
    await actOnServiceRequest(ctx.access, text(form, "requestId"), action.data, {
      ...(kind.success ? { kind: kind.data } : {}),
      note: text(form, "note"),
    });
  });
}
