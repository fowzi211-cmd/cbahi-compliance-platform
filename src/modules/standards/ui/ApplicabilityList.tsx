import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription } from "@/components/ui/card";
import { Field, Label, Select } from "@/components/ui/input";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type {
  ApplicabilityElement,
  ApplicabilityFilter,
  ApplicabilityReason,
} from "../domain/applicability";
import { localized } from "../domain/display";
import type { FormState } from "@/lib/form-state";
import type { getApplicability } from "../service";
import { ApplicabilityDecisionForm } from "./ApplicabilityDecisionForm";
import { LocalizedText } from "./LocalizedText";

type Data = NonNullable<Awaited<ReturnType<typeof getApplicability>>>;

const reasonVariant: Record<ApplicabilityReason, "success" | "default" | "warning"> = {
  applies: "success",
  markedApplicable: "success",
  otherFacilityType: "default",
  markedNotApplicable: "warning",
};

/** One chosen edition as it applies to the facility, with a decision form per element. */
export async function ApplicabilityList({
  locale,
  data,
  filter,
  path,
  frameworkParam,
  canDecide,
  action,
}: {
  locale: Locale;
  data: Data;
  filter: ApplicabilityFilter;
  path: string;
  // Kept in the filter form when the facility uses more than one edition.
  frameworkParam?: string;
  canDecide: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = await getTranslations({ locale, namespace: "onboarding.applicability" });
  const { counts, groups, shown } = data.view;
  const filtered = Boolean(filter.chapter || filter.onlyNotApplicable);

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm" data-testid="applicability-counts">
        {t("counts", {
          total: counts.total,
          applicable: counts.applicable,
          notApplicable: counts.notApplicable,
        })}
      </p>
      {counts.esrNotApplicable > 0 && (
        <p className="text-danger flex items-center gap-2 text-sm">
          <ShieldAlert className="size-4" aria-hidden />
          {t("esrRuledOut", { count: counts.esrNotApplicable })}
        </p>
      )}

      <form
        method="get"
        action={getPathname({ href: path, locale })}
        className="flex flex-wrap items-end gap-3"
      >
        {frameworkParam && <input type="hidden" name="framework" value={frameworkParam} />}
        <Field>
          <Label htmlFor="applicability-chapter">{t("chapter")}</Label>
          <Select
            id="applicability-chapter"
            name="chapter"
            defaultValue={filter.chapter ?? ""}
            className="min-w-48"
          >
            <option value="">{t("allChapters")}</option>
            {data.chapters.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} · {localized(locale, c.titleAr, c.titleEn).text}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="na"
            value="1"
            defaultChecked={filter.onlyNotApplicable}
            className="size-4"
          />
          {t("onlyNotApplicable")}
        </label>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
        {filtered && (
          <Button asChild variant="ghost">
            <Link href={frameworkParam ? `${path}?framework=${frameworkParam}` : path}>
              {t("reset")}
            </Link>
          </Button>
        )}
      </form>

      {shown === 0 ? (
        <Card>
          <CardDescription>{t("empty")}</CardDescription>
        </Card>
      ) : (
        groups.map(({ chapter, elements }) => (
          <section
            key={chapter.id}
            data-chapter={chapter.code}
            aria-labelledby={`app-ch-${chapter.id}`}
            className="flex flex-col gap-2"
          >
            <h3 id={`app-ch-${chapter.id}`} className="font-semibold">
              <bdi dir="ltr">{chapter.code}</bdi>{" "}
              <LocalizedText locale={locale} ar={chapter.titleAr} en={chapter.titleEn} />
            </h3>
            <ul className="flex flex-col gap-2">
              {elements.map((element) => (
                <ElementRow
                  key={element.id}
                  locale={locale}
                  element={element}
                  canDecide={canDecide}
                  action={action}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

async function ElementRow({
  locale,
  element,
  canDecide,
  action,
}: {
  locale: Locale;
  element: ApplicabilityElement;
  canDecide: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = await getTranslations({ locale, namespace: "onboarding.applicability" });
  const tStandards = await getTranslations({ locale, namespace: "standards" });
  return (
    <li
      data-element={element.code}
      data-applicable={element.applicable}
      className={cn(
        "border-border rounded-md border p-3",
        !element.applicable && "bg-muted/50",
        element.isEsr && "border-s-danger/60 border-s-4",
      )}
    >
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2">
          <bdi dir="ltr" className="font-mono text-sm font-medium">
            {element.code}
          </bdi>
          {element.isEsr && <Badge variant="danger">{tStandards("esr.badge")}</Badge>}
          <span className="min-w-0 flex-1">
            <LocalizedText locale={locale} ar={element.titleAr} en={element.titleEn} />
          </span>
          <Badge variant={reasonVariant[element.reason]} data-testid="applicability-reason">
            {t(`reasons.${element.reason}`)}
          </Badge>
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {element.justification && (
            <p>
              <span className="font-medium">{t("recordedReason")}</span>{" "}
              <span dir="auto">{element.justification}</span>
              {element.decidedAt && (
                <span className="text-muted-foreground">
                  {" "}
                  ({formatDate(element.decidedAt, locale, { style: "medium" })})
                </span>
              )}
            </p>
          )}
          {canDecide && (
            <ApplicabilityDecisionForm
              elementId={element.id}
              reason={element.reason}
              isEsr={element.isEsr}
              action={action}
            />
          )}
        </div>
      </details>
    </li>
  );
}
