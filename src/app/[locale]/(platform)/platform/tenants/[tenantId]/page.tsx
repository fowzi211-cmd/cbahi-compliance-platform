import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requirePlatformAdmin } from "@/lib/session";
import { localized } from "@/modules/standards/service";
import {
  features,
  getTenantForPlatform,
  listConsultantAccounts,
  tierMatrix,
  tiers,
} from "@/modules/subscriptions/service";
import { Feedback, TierBadge } from "@/modules/subscriptions/ui/Badges";
import {
  assignConsultantAction,
  endAssignmentAction,
  updateSubscriptionAction,
} from "../../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/platform/tenants/[tenantId]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "platform.tenants" });
  return { title: t("detailTitle") };
}

export default async function TenantPage({
  params,
  searchParams,
}: PageProps<"/[locale]/platform/tenants/[tenantId]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("platform.tenants");
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/platform/tenants" className="text-primary text-sm hover:underline">
        {t("back")}
      </Link>
      <Suspense fallback={<Pending />}>
        <Tenant locale={locale as Locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Tenant({
  locale,
  params,
  searchParams,
}: {
  locale: Locale;
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations({ locale, namespace: "platform.tenants" });
  const ts = await getTranslations({ locale, namespace: "subscriptions" });
  const user = await requirePlatformAdmin(locale);
  const actor = { userId: user.id, isPlatformAdmin: true };
  const { tenantId } = await params;
  const [tenant, consultants] = await Promise.all([
    getTenantForPlatform(actor, tenantId),
    listConsultantAccounts(actor),
  ]);
  if (!tenant) notFound();
  const sub = tenant.subscription;
  const override = (f: (typeof features)[number]) =>
    sub.featureOverrides[f] === undefined ? "tier" : sub.featureOverrides[f] ? "on" : "off";

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-3xl">
          <span dir="auto">{tenant.name}</span>
          <TierBadge locale={locale} tier={sub.effectiveTier} />
        </h1>
        {sub.tier !== sub.effectiveTier && <p className="text-warning text-sm">{t("lapsed")}</p>}
      </div>
      <Feedback locale={locale} query={await searchParams} />

      <Card className="flex flex-col gap-4" data-testid="subscription-form">
        <CardTitle>{t("subscription")}</CardTitle>
        <form action={updateSubscriptionAction} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <Label htmlFor="tier">{t("tier")}</Label>
              <Select id="tier" name="tier" defaultValue={sub.tier}>
                {tiers.map((tier) => (
                  <option key={tier} value={tier}>
                    {ts(`tiers.${tier}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="starts-on">{t("startsOn")}</Label>
              <Input
                id="starts-on"
                name="startsOn"
                type="date"
                required
                defaultValue={sub.startsOn}
              />
            </Field>
            <Field>
              <Label htmlFor="ends-on">{t("endsOn")}</Label>
              <Input
                id="ends-on"
                name="endsOn"
                type="date"
                defaultValue={sub.endsOn ?? ""}
                aria-describedby="ends-on-hint"
              />
              <FieldHint id="ends-on-hint">{t("endsOnHint")}</FieldHint>
            </Field>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t("features")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {features.map((f) => (
                <Field key={f}>
                  <Label htmlFor={`feature-${f}`}>{ts(`features.${f}`)}</Label>
                  <Select id={`feature-${f}`} name={`feature-${f}`} defaultValue={override(f)}>
                    <option value="tier">
                      {t("followTier", {
                        platform: t(tierMatrix.platform[f] ? "on" : "off"),
                        hybrid: t(tierMatrix.hybrid[f] ? "on" : "off"),
                      })}
                    </option>
                    <option value="on">{t("forceOn")}</option>
                    <option value="off">{t("forceOff")}</option>
                  </Select>
                </Field>
              ))}
            </div>
          </fieldset>
          <div>
            <Button type="submit">{t("save")}</Button>
          </div>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("facilities")}</h2>
        {!sub.enabled.includes("consultantAssignment") && (
          <CardDescription>{t("consultantsOff")}</CardDescription>
        )}
        {tenant.facilities.map((f) => (
          <Card key={f.id} className="flex flex-col gap-3" data-testid="platform-facility">
            <h3 className="font-semibold">{localized(locale, f.nameAr, f.nameEn).text}</h3>
            {f.consultants.length === 0 ? (
              <CardDescription>{t("noConsultants")}</CardDescription>
            ) : (
              <ul className="divide-border flex flex-col divide-y text-sm">
                {f.consultants.map((c) => (
                  <li
                    key={c.assignmentId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      {c.name} · <bdi dir="ltr">{c.email}</bdi> ·{" "}
                      {t("since", { date: formatDate(c.since, locale, { style: "medium" }) })}
                    </span>
                    <form action={endAssignmentAction}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <input type="hidden" name="assignmentId" value={c.assignmentId} />
                      <Button type="submit" variant="outline" size="sm">
                        {t("endAssignment")}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {consultants.length > 0 && (
              <form action={assignConsultantAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenantId" value={tenant.id} />
                <input type="hidden" name="facilityId" value={f.id} />
                <Field className="min-w-0 flex-1">
                  <Label htmlFor={`consultant-${f.id}`}>{t("consultant")}</Label>
                  <Select id={`consultant-${f.id}`} name="userId" required defaultValue="">
                    <option value="" disabled>
                      {t("chooseConsultant")}
                    </option>
                    {consultants.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.email})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="outline">
                  {t("assign")}
                </Button>
              </form>
            )}
          </Card>
        ))}
      </section>
    </>
  );
}
