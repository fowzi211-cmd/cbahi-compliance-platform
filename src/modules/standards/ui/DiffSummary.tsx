import { useLocale, useTranslations } from "next-intl";
import type { EditionDiff } from "../domain/diff";

const LIMIT = 50;

function Codes({ codes }: { codes: readonly string[] }) {
  const t = useTranslations("platform.standards.diff");
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
      {codes.slice(0, LIMIT).map((code) => (
        <bdi key={code} dir="ltr">
          {code}
        </bdi>
      ))}
      {codes.length > LIMIT && (
        <span className="font-sans">{t("more", { count: codes.length - LIMIT })}</span>
      )}
    </p>
  );
}

/** What changes for facilities if this edition replaces the live one. */
export function DiffSummary({ diff }: { diff: EditionDiff }) {
  const t = useTranslations("platform.standards.diff");
  const tFields = useTranslations("platform.standards.diff.fields");
  const list = new Intl.ListFormat(useLocale(), { type: "unit" });
  const rows = [
    ["esrAdded", diff.esr.added],
    ["esrRemoved", diff.esr.removed],
    ["elementsAdded", diff.elements.added],
    ["elementsRemoved", diff.elements.removed],
    ["chaptersAdded", diff.chapters.added],
    ["chaptersRemoved", diff.chapters.removed],
    ["chaptersChanged", diff.chapters.changed],
    ["standardsAdded", diff.standards.added],
    ["standardsRemoved", diff.standards.removed],
    ["standardsChanged", diff.standards.changed],
  ] as const;

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="edition-diff">
      {rows
        .filter(([, codes]) => codes.length > 0)
        .map(([key, codes]) => (
          <div key={key} className="flex flex-col gap-1" data-diff={key}>
            <h3 className={key.startsWith("esr") ? "text-danger font-medium" : "font-medium"}>
              {t(key, { count: codes.length })}
            </h3>
            <Codes codes={codes} />
          </div>
        ))}
      {diff.elements.changed.length > 0 && (
        <div className="flex flex-col gap-1" data-diff="elementsChanged">
          <h3 className="font-medium">
            {t("elementsChanged", { count: diff.elements.changed.length })}
          </h3>
          <ul className="flex flex-col gap-1 text-xs">
            {diff.elements.changed.slice(0, LIMIT).map((c) => (
              <li key={c.code}>
                <bdi dir="ltr" className="font-mono">
                  {c.code}
                </bdi>
                {": "}
                {list.format(c.fields.map((f) => tFields(f)))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted-foreground">{t("unchanged", { count: diff.unchangedElements })}</p>
    </div>
  );
}
