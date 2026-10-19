import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/dates";
import type { FormState } from "@/lib/form-state";
import { localized } from "@/modules/standards/service";
import { cn } from "@/lib/utils";
import type { AssessmentSheet } from "../service";
import { Localized } from "./Localized";
import { RemoveEvidenceButton } from "./RemoveEvidenceButton";
import { ScoreForm, type LevelOption } from "./ScoreForm";

type Action = (state: FormState, form: FormData) => Promise<FormState>;
type SheetElement = AssessmentSheet["chapters"][number]["standards"][number]["elements"][number];

const severityVariant = {
  esr: "danger",
  high: "danger",
  medium: "warning",
  low: "default",
} as const;

/** The elements in scope, chapter by chapter, each with its score, evidence and form. */
export async function AssessmentSheetView({
  locale,
  sheet,
  saveAction,
  removeEvidenceAction,
}: {
  locale: Locale;
  sheet: AssessmentSheet;
  saveAction: Action;
  removeEvidenceAction: Action;
}) {
  const t = await getTranslations({ locale, namespace: "assessments" });
  const levelLabel = new Map(
    sheet.scale.map((l) => [l.code, localized(locale, l.labelAr, l.labelEn).text || l.code]),
  );
  const levelsFor = (isEsr: boolean): LevelOption[] =>
    sheet.scale.map((l) => ({
      code: l.code,
      label: levelLabel.get(l.code)!,
      allowed: !isEsr || sheet.esrAllowedLevels.includes(l.code),
    }));

  return (
    <div className="flex flex-col gap-6">
      {sheet.chapters.map((chapter) => (
        <section
          key={chapter.id}
          aria-labelledby={`sheet-ch-${chapter.id}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`sheet-ch-${chapter.id}`} className="text-lg font-semibold">
            <bdi dir="ltr">{chapter.code}</bdi>{" "}
            <Localized locale={locale} ar={chapter.titleAr} en={chapter.titleEn} />
          </h2>
          {chapter.standards.map((standard) => (
            <div key={standard.id} className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-sm font-medium">
                <bdi dir="ltr">{standard.code}</bdi>{" "}
                <Localized locale={locale} ar={standard.titleAr} en={standard.titleEn} />
              </h3>
              <ul className="flex flex-col gap-2">
                {standard.elements.map((element) => (
                  <ElementRow
                    key={element.id}
                    locale={locale}
                    element={element}
                    levelLabel={levelLabel.get(element.score?.levelCode ?? "")}
                    sheet={sheet}
                    levels={levelsFor(element.isEsr)}
                    saveAction={saveAction}
                    removeEvidenceAction={removeEvidenceAction}
                    t={t}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

async function ElementRow({
  locale,
  element,
  levelLabel,
  sheet,
  levels,
  saveAction,
  removeEvidenceAction,
  t,
}: {
  locale: Locale;
  element: SheetElement;
  levelLabel: string | undefined;
  sheet: AssessmentSheet;
  levels: LevelOption[];
  saveAction: Action;
  removeEvidenceAction: Action;
  t: Awaited<ReturnType<typeof getTranslations<"assessments">>>;
}) {
  const tStandards = await getTranslations({ locale, namespace: "standards" });
  const { score } = element;
  return (
    <li
      data-element={element.code}
      data-scored={score ? "true" : "false"}
      className={cn(
        "border-border rounded-md border p-3",
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
            <Localized locale={locale} ar={element.titleAr} en={element.titleEn} />
          </span>
          <Badge variant={score ? "success" : "default"} data-testid="element-level">
            {score ? levelLabel : t("sheet.notScored")}
          </Badge>
        </summary>
        <div className="mt-3 flex flex-col gap-4 text-sm">
          {(element.descriptionAr || element.descriptionEn) && (
            <p className="text-muted-foreground">
              <Localized locale={locale} ar={element.descriptionAr} en={element.descriptionEn} />
            </p>
          )}
          {score && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">
                {t("score.scoredOn", { date: formatDateTime(score.scoredAt, locale) })}
              </p>
              {score.comment && (
                <p>
                  <span className="font-medium">{t("score.comment")}:</span>{" "}
                  <span dir="auto">{score.comment}</span>
                </p>
              )}
              <h4 className="font-medium">{t("score.evidenceTitle")}</h4>
              {score.evidence.length === 0 ? (
                <p className="text-muted-foreground">{t("score.noEvidenceYet")}</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="evidence-list">
                  {score.evidence.map((item) => (
                    <li
                      key={item.id}
                      className="bg-muted/50 flex flex-wrap items-start justify-between gap-2 rounded-md p-2"
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{t(`evidenceKinds.${item.kind}`)}</span>
                        {item.note && <span dir="auto">{item.note}</span>}
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-primary inline-flex items-center gap-1 break-all hover:underline"
                          >
                            <bdi dir="ltr">{item.url}</bdi>
                            <ExternalLink className="size-3 shrink-0" aria-hidden />
                          </a>
                        )}
                      </span>
                      {sheet.canScore && (
                        <RemoveEvidenceButton evidenceId={item.id} action={removeEvidenceAction} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {sheet.canScore && (
            <ScoreForm
              assessmentId={sheet.assessment.id}
              elementId={element.id}
              levels={levels}
              current={score && { levelCode: score.levelCode, comment: score.comment }}
              isEsr={element.isEsr}
              action={saveAction}
            />
          )}
        </div>
      </details>
    </li>
  );
}

/** The findings a submitted assessment raised. */
export async function AssessmentFindings({
  locale,
  sheet,
}: {
  locale: Locale;
  sheet: AssessmentSheet;
}) {
  const t = await getTranslations({ locale, namespace: "assessments.findings" });
  const levelLabel = new Map(
    sheet.scale.map((l) => [l.code, localized(locale, l.labelAr, l.labelEn).text || l.code]),
  );
  return (
    <Card className="flex flex-col gap-3" data-testid="assessment-findings">
      <CardTitle>{t("title")}</CardTitle>
      {sheet.findings.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sheet.findings.map((finding) => (
            <li
              key={finding.id}
              data-finding={finding.element.code}
              className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm"
            >
              <span className="flex flex-wrap items-baseline gap-2">
                <bdi dir="ltr" className="font-mono font-medium">
                  {finding.element.code}
                </bdi>
                <Badge variant={severityVariant[finding.severity]} data-testid="finding-severity">
                  {t(`severity.${finding.severity}`)}
                </Badge>
                <Badge>{levelLabel.get(finding.levelCode) ?? finding.levelCode}</Badge>
                <Badge>{t(`status.${finding.status}`)}</Badge>
              </span>
              <span>
                <Localized
                  locale={locale}
                  ar={finding.element.titleAr}
                  en={finding.element.titleEn}
                />
              </span>
              {finding.statement && (
                <span className="text-muted-foreground" dir="auto">
                  {finding.statement}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
