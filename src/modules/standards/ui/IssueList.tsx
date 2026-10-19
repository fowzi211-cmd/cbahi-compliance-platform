import { useTranslations } from "next-intl";
import type { ImportIssue } from "../domain/issues";

const SHOWN = 100;

/**
 * Import problems with where to find them (sheet, row, column), in the reader's language.
 * Long lists are cut at 100 with a count, since the first errors usually explain the rest.
 */
export function IssueList({ issues }: { issues: readonly ImportIssue[] }) {
  const t = useTranslations("platform.standards.issues");
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2 text-sm" data-testid="import-issues">
        {issues.slice(0, SHOWN).map((issue, index) => (
          <li
            key={index}
            data-code={issue.code}
            className="border-border data-[severity=error]:border-danger data-[severity=warning]:border-warning flex flex-col gap-0.5 border-s-2 ps-3"
            data-severity={issue.severity}
          >
            <span>
              {t(`codes.${issue.code}`, {
                value: issue.value ?? "",
                sheet: issue.sheet ?? "",
                column: issue.column ?? "",
              })}
            </span>
            {(issue.sheet || issue.row) && (
              <span className="text-muted-foreground text-xs">
                {issue.sheet && <bdi dir="ltr">{issue.sheet}</bdi>}
                {issue.row !== undefined && <> · {t("row", { row: issue.row })}</>}
                {issue.column && (
                  <>
                    {" "}
                    · <bdi dir="ltr">{issue.column}</bdi>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {issues.length > SHOWN && (
        <p className="text-muted-foreground text-sm">
          {t("more", { count: issues.length - SHOWN })}
        </p>
      )}
    </div>
  );
}
