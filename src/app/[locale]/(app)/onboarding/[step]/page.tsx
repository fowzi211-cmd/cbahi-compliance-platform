import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext, type AppContext } from "@/lib/session";
import {
  getApplicability,
  getFrameworkChoices,
  listCatalogues,
  listFacilityFrameworks,
  localized,
} from "@/modules/standards/service";
import { ApplicabilityList } from "@/modules/standards/ui/ApplicabilityList";
import { FrameworkChoiceForm } from "@/modules/standards/ui/FrameworkChoiceForm";
import { getSurveyCycle } from "@/modules/surveys/service";
import { SurveyCycleForm } from "@/modules/surveys/ui/SurveyCycleForm";
import {
  allowed,
  assignableRoles,
  getFacility,
  getOnboardingProgress,
  isOnboardingStep,
  listDepartments,
  listFacilityMembers,
  listOpenInvitations,
  onboardingSteps,
  type OnboardingStep,
} from "@/modules/tenancy/service";
import { DepartmentForm } from "@/modules/tenancy/ui/DepartmentForm";
import { FacilityProfileForm } from "@/modules/tenancy/ui/FacilityProfileForm";
import { InviteForm } from "@/modules/tenancy/ui/InviteForm";
import { OnboardingStepper } from "@/modules/tenancy/ui/OnboardingStepper";
import { inviteAction } from "../../people/actions";
import {
  addDepartmentAction,
  archiveDepartmentAction,
  continueAction,
  decideApplicabilityAction,
  saveFacilityAction,
  saveFrameworksAction,
  saveSurveyAction,
} from "../actions";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => onboardingSteps.map((step) => ({ locale, step })));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding/[step]">): Promise<Metadata> {
  const { locale, step } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "onboarding" });
  return { title: isOnboardingStep(step) ? t(`steps.${step}`) : t("title") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OnboardingStepPage({
  params,
  searchParams,
}: PageProps<"/[locale]/onboarding/[step]">) {
  const { locale, step } = await params;
  if (!isOnboardingStep(step)) notFound();
  setRequestLocale(locale as Locale);
  const t = await getTranslations("onboarding");
  const number = onboardingSteps.indexOf(step) + 1;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          {t("title")} · {t("stepOf", { number, total: onboardingSteps.length })}
        </p>
        <h1 className="text-2xl font-bold sm:text-3xl">{t(`steps.${step}`)}</h1>
        <p className="text-muted-foreground max-w-prose">{t(`hints.${step}`)}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <StepBody locale={locale as Locale} step={step} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function StepBody({
  locale,
  step,
  searchParams,
}: {
  locale: Locale;
  step: OnboardingStep;
  searchParams: SearchParams;
}) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const ctx = await requireAppContext(locale);
  const progress = await getOnboardingProgress(ctx.access, ctx.facilityId);
  const stepper = <OnboardingStepper locale={locale} current={step} done={progress?.done ?? []} />;

  // Setup is the owner's job (it decides what the facility is assessed against).
  if (!allowed(ctx.access, "facility.updateSettings", { facilityId: ctx.facilityId })) {
    return (
      <>
        {stepper}
        <Card>
          <CardDescription>{t("forbidden")}</CardDescription>
        </Card>
      </>
    );
  }

  const body = {
    facility: () => <FacilityStep ctx={ctx} />,
    frameworks: () => <FrameworksStep locale={locale} ctx={ctx} />,
    applicability: () => (
      <ApplicabilityStep locale={locale} ctx={ctx} searchParams={searchParams} />
    ),
    departments: () => <DepartmentsStep locale={locale} ctx={ctx} />,
    people: () => <PeopleStep locale={locale} ctx={ctx} />,
    survey: () => <SurveyStep locale={locale} ctx={ctx} />,
  }[step];

  return (
    <>
      {stepper}
      {body()}
    </>
  );
}

async function ContinueButton({ locale, step }: { locale: Locale; step: OnboardingStep }) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  return (
    <form action={continueAction}>
      <input type="hidden" name="step" value={step} />
      <Button type="submit">{t("continue")}</Button>
    </form>
  );
}

async function FacilityStep({ ctx }: { ctx: AppContext }) {
  const facility = await getFacility(ctx.access, ctx.facilityId);
  if (!facility) notFound();
  return (
    <Card>
      <FacilityProfileForm facility={facility} action={saveFacilityAction} />
    </Card>
  );
}

async function FrameworksStep({ locale, ctx }: { locale: Locale; ctx: AppContext }) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const tSetup = await getTranslations({ locale, namespace: "setup" });
  const data = await getFrameworkChoices(ctx.access, ctx.facilityId);
  if (!data) notFound();
  if (data.choices.length === 0) {
    return (
      <Card>
        <CardDescription>{t("frameworks.none")}</CardDescription>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4">
      <CardDescription>
        {t("frameworks.forType", {
          type: tSetup(`facilityTypes.${data.facilityType}` as "facilityTypes.other"),
        })}
      </CardDescription>
      <FrameworkChoiceForm
        choices={data.choices.map((c) => {
          const name = localized(locale, c.nameAr, c.nameEn);
          return {
            id: c.id,
            code: c.code,
            edition: c.edition,
            name: name.text,
            lang: name.lang,
            elements: c._count.elements,
            esr: c.esrCount,
            suggested: c.suggested,
            checked: data.firstVisit ? c.suggested : c.selected,
            retired: c.status === "retired",
          };
        })}
        action={saveFrameworksAction}
      />
    </Card>
  );
}

const applicabilityParams = z.object({
  framework: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.uuid().optional().catch(undefined),
  ),
  chapter: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.string().trim().max(64).optional().catch(undefined),
  ),
  na: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().optional().catch(undefined)),
});

async function ApplicabilityStep({
  locale,
  ctx,
  searchParams,
}: {
  locale: Locale;
  ctx: AppContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const frameworks = await listFacilityFrameworks(ctx.access, ctx.facilityId);
  if (frameworks.length === 0) {
    return (
      <Card className="flex flex-col gap-3">
        <CardDescription>{t("applicability.noFrameworks")}</CardDescription>
        <div>
          <Button asChild variant="outline">
            <Link href="/onboarding/frameworks">{t("steps.frameworks")}</Link>
          </Button>
        </div>
      </Card>
    );
  }
  const query = applicabilityParams.parse(await searchParams);
  const framework = frameworks.find((f) => f.id === query.framework) ?? frameworks[0]!;
  const filter = { chapter: query.chapter || undefined, onlyNotApplicable: query.na === "1" };
  const data = await getApplicability(ctx.access, ctx.facilityId, framework.id, filter);
  if (!data) notFound();
  const path = "/onboarding/applicability";

  return (
    <>
      {frameworks.length > 1 && (
        <nav aria-label={t("steps.frameworks")} className="flex flex-wrap gap-2">
          {frameworks.map((f) => (
            <Button
              key={f.id}
              asChild
              size="sm"
              variant={f.id === framework.id ? "default" : "outline"}
            >
              <Link
                href={{ pathname: path, query: { framework: f.id } }}
                aria-current={f.id === framework.id ? "true" : undefined}
              >
                {localized(locale, f.nameAr, f.nameEn).text}
              </Link>
            </Button>
          ))}
        </nav>
      )}
      <Card className="flex flex-col gap-4">
        <CardTitle>{localized(locale, framework.nameAr, framework.nameEn).text}</CardTitle>
        <ApplicabilityList
          locale={locale}
          data={data}
          filter={filter}
          path={path}
          frameworkParam={frameworks.length > 1 ? framework.id : undefined}
          canDecide
          action={decideApplicabilityAction}
        />
      </Card>
      <ContinueButton locale={locale} step="applicability" />
    </>
  );
}

async function DepartmentsStep({ locale, ctx }: { locale: Locale; ctx: AppContext }) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const [departments, catalogues] = await Promise.all([
    listDepartments(ctx.access, ctx.facilityId),
    listCatalogues(ctx.access),
  ]);
  const typeName = new Map(
    catalogues.departmentTypes.map((d) => [d.code, locale === "ar" ? d.nameAr : d.nameEn]),
  );

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("departments.listTitle")}</CardTitle>
        {departments.length === 0 ? (
          <CardDescription>{t("departments.empty")}</CardDescription>
        ) : (
          <ul className="flex flex-col" data-testid="department-list">
            {departments.map((d) => (
              <li
                key={d.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 border-t py-2 first:border-t-0"
              >
                <span>
                  <span className="font-medium">{locale === "ar" ? d.nameAr : d.nameEn}</span>
                  {d.typeCode && (
                    <span className="text-muted-foreground text-sm">
                      {" "}
                      · {typeName.get(d.typeCode) ?? d.typeCode}
                    </span>
                  )}
                </span>
                <form action={archiveDepartmentAction}>
                  <input type="hidden" name="departmentId" value={d.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    aria-label={t("departments.archiveLabel", {
                      name: locale === "ar" ? d.nameAr : d.nameEn,
                    })}
                  >
                    {t("departments.archive")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("departments.addTitle")}</CardTitle>
        <DepartmentForm
          types={catalogues.departmentTypes.map((d) => ({
            code: d.code,
            name: typeName.get(d.code)!,
          }))}
          action={addDepartmentAction}
        />
      </Card>
      <ContinueButton locale={locale} step="departments" />
    </>
  );
}

async function PeopleStep({ locale, ctx }: { locale: Locale; ctx: AppContext }) {
  const t = await getTranslations({ locale });
  const [members, invitations, departments] = await Promise.all([
    listFacilityMembers(ctx.access, ctx.facilityId),
    listOpenInvitations(ctx.access, ctx.facilityId),
    listDepartments(ctx.access, ctx.facilityId),
  ]);

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("people.invite.title")}</CardTitle>
        <InviteForm
          facilityId={ctx.facilityId}
          roles={assignableRoles(ctx.access.actor, ctx.facilityId)}
          departments={departments.map((d) => ({
            id: d.id,
            name: locale === "ar" ? d.nameAr : d.nameEn,
          }))}
          action={inviteAction}
        />
      </Card>
      <Card className="flex flex-col gap-3">
        <CardDescription>
          {t("onboarding.people.summary", {
            members: members.length,
            invitations: invitations.length,
          })}
        </CardDescription>
        {invitations.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm" data-testid="onboarding-invitations">
            {invitations.map((inv) => (
              <li key={inv.id}>
                <bdi dir="ltr">{inv.email}</bdi> · {t(`roles.${inv.role}`)} ·{" "}
                {t("onboarding.people.expires", {
                  date: formatDate(inv.expiresAt, locale, { style: "medium" }),
                })}
              </li>
            ))}
          </ul>
        )}
        <Link href="/people" className="text-primary text-sm hover:underline">
          {t("onboarding.people.manage")}
        </Link>
      </Card>
      <ContinueButton locale={locale} step="people" />
    </>
  );
}

async function SurveyStep({ locale, ctx }: { locale: Locale; ctx: AppContext }) {
  const t = await getTranslations({ locale, namespace: "onboarding" });
  const cycle = await getSurveyCycle(ctx.access, ctx.facilityId);
  if (!cycle) notFound();
  return (
    <Card>
      <SurveyCycleForm cycle={cycle} submitLabel={t("survey.finish")} action={saveSurveyAction} />
    </Card>
  );
}
