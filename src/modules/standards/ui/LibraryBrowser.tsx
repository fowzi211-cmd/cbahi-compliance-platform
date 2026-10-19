import { ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { Link, getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { BrowseElement, BrowseFilter } from "../domain/browse";
import { localized } from "../domain/display";
import type { EvidenceType } from "../domain/import-format";
import type { LibraryBrowse } from "../service";
import { LocalizedText } from "./LocalizedText";

const anchor = (code: string) => `element-${code.replace(/[^\p{L}\p{N}_-]/gu, "-")}`;

/**
 * One edition, browsable by chapter and department. Filters are a plain GET form, so the
 * page works without JavaScript and a filtered view can be shared as a link.
 */
export async function LibraryBrowser({
  locale,
  data,
  filter,
  path,
}: {
  locale: Locale;
  data: LibraryBrowse;
  filter: BrowseFilter;
  path: string;
}) {
  const t = await getTranslations({ locale, namespace: "standards" });
  const { view, departments } = data;
  const departmentName = (code: string) => {
    const d = departments.find((x) => x.code === code);
    return d ? (locale === "ar" ? d.nameAr : d.nameEn) : code;
  };
  const filtered = Boolean(filter.chapter || filter.department || filter.esrOnly || filter.query);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("browse.filters")}</CardTitle>
        <form
          method="get"
          action={getPathname({ href: path, locale })}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field>
            <Label htmlFor="filter-chapter">{t("browse.chapter")}</Label>
            <Select id="filter-chapter" name="chapter" defaultValue={filter.chapter ?? ""}>
              <option value="">{t("browse.allChapters")}</option>
              {view.chapters.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {localized(locale, c.titleAr, c.titleEn).text}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="filter-department">{t("browse.department")}</Label>
            <Select id="filter-department" name="department" defaultValue={filter.department ?? ""}>
              <option value="">{t("browse.allDepartments")}</option>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {locale === "ar" ? d.nameAr : d.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="filter-query">{t("browse.search")}</Label>
            <Input id="filter-query" name="q" type="search" defaultValue={filter.query ?? ""} />
          </Field>
          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="esr"
                value="1"
                defaultChecked={filter.esrOnly}
                className="size-4"
              />
              {t("browse.esrOnly")}
            </label>
            <div className="flex gap-2">
              <Button type="submit">{t("browse.apply")}</Button>
              {filtered && (
                <Button asChild variant="outline">
                  <Link href={path}>{t("browse.reset")}</Link>
                </Button>
              )}
            </div>
          </div>
        </form>
      </Card>

      <nav aria-label={t("browse.chapters")} className="flex flex-wrap gap-2">
        {view.chapters.map((c) => (
          <Link
            key={c.id}
            href={{ pathname: path, query: { chapter: c.code } }}
            aria-current={filter.chapter === c.code ? "true" : undefined}
            className={cn(
              "border-border hover:bg-muted rounded-full border px-3 py-1 text-sm",
              filter.chapter === c.code && "bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            <bdi dir="ltr">{c.code}</bdi>{" "}
            <span className="opacity-80">
              {t("browse.chapterCounts", { elements: c.elementCount, esr: c.esrCount })}
            </span>
          </Link>
        ))}
      </nav>

      <p role="status" className="text-muted-foreground text-sm">
        {t("browse.results", { count: view.total })}
      </p>

      {view.esr.length > 0 && (
        <Card className="border-danger/40 flex flex-col gap-3 border-s-4">
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="text-danger size-5" aria-hidden />
            {t("esr.title")}
          </CardTitle>
          <CardDescription>{t("esr.hint")}</CardDescription>
          <ul className="flex flex-col gap-1 text-sm" data-testid="esr-summary">
            {view.esr.map((e) => (
              <li key={e.id}>
                <a href={`#${anchor(e.code)}`} className="hover:underline">
                  <bdi dir="ltr" className="font-mono font-medium">
                    {e.code}
                  </bdi>{" "}
                  <LocalizedText locale={locale} ar={e.titleAr} en={e.titleEn} />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view.groups.map(({ chapter, standards }) => (
        <section
          key={chapter.id}
          data-chapter={chapter.code}
          className="flex flex-col gap-4"
          aria-labelledby={`ch-${chapter.id}`}
        >
          <h2 id={`ch-${chapter.id}`} className="text-xl font-bold">
            <bdi dir="ltr">{chapter.code}</bdi>{" "}
            <LocalizedText locale={locale} ar={chapter.titleAr} en={chapter.titleEn} />
          </h2>
          {standards.map(({ standard, elements }) => (
            <Card key={standard.id} className="flex flex-col gap-3">
              <h3 className="font-semibold">
                <bdi dir="ltr">{standard.code}</bdi>{" "}
                <LocalizedText locale={locale} ar={standard.titleAr} en={standard.titleEn} />
              </h3>
              <ul className="flex flex-col gap-2">
                {elements.map((element) => (
                  <ElementItem
                    key={element.id}
                    locale={locale}
                    element={element}
                    departmentName={departmentName}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}

async function ElementItem({
  locale,
  element,
  departmentName,
}: {
  locale: Locale;
  element: BrowseElement;
  departmentName: (code: string) => string;
}) {
  const t = await getTranslations({ locale, namespace: "standards" });
  const description = localized(locale, element.descriptionAr, element.descriptionEn);
  const list = new Intl.ListFormat(locale, { type: "unit" });
  return (
    <li
      id={anchor(element.code)}
      data-esr={element.isEsr || undefined}
      className={cn(
        "border-border rounded-md border p-3",
        element.isEsr && "border-danger/50 bg-danger/5 border-s-4",
      )}
    >
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2">
          <bdi dir="ltr" className="font-mono text-sm font-medium">
            {element.code}
          </bdi>
          {element.isEsr && <Badge variant="danger">{t("esr.badge")}</Badge>}
          <span className="min-w-0 flex-1">
            <LocalizedText locale={locale} ar={element.titleAr} en={element.titleEn} />
          </span>
        </summary>
        <dl className="text-muted-foreground mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          {description.text !== "" && (
            <>
              <dt className="font-medium">{t("element.description")}</dt>
              <dd lang={description.lang} dir="auto">
                {description.text}
              </dd>
            </>
          )}
          <dt className="font-medium">{t("element.evidence")}</dt>
          <dd>
            {element.evidenceTypes.length === 0
              ? t("element.notSpecified")
              : list.format(
                  element.evidenceTypes.map((e) => t(`evidenceTypes.${e as EvidenceType}`)),
                )}
          </dd>
          <dt className="font-medium">{t("element.departments")}</dt>
          <dd>
            {element.departmentTypes.length === 0
              ? t("element.facilityWide")
              : list.format(element.departmentTypes.map(departmentName))}
          </dd>
          <dt className="font-medium">{t("element.weight")}</dt>
          <dd>{element.weight}</dd>
        </dl>
      </details>
    </li>
  );
}
