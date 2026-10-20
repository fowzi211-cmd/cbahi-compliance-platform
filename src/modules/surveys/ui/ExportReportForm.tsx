"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { idleState, type FormState } from "@/lib/form-state";

/**
 * Issues the report. Like any document it needs the "no patient data" statement, and a
 * second confirmation when the scan finds something that looks like patient data.
 */
export function ExportReportForm({
  assessmentId,
  action,
}: {
  assessmentId: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("mockSurveys");
  const [state, formAction, pending] = useActionState(action, idleState);
  const phiDetected = state.status === "error" && state.error === "phiDetected";
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.status === "error" && !phiDetected ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="phiAttested" value="true" required className="mt-1 size-4" />
        <span>{t("export.attest")}</span>
      </label>
      {phiDetected && (
        <div className="border-warning bg-warning/10 flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm" role="alert">
            {t("export.phiFound")}
          </p>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="phiConfirmed"
              value="true"
              required
              className="mt-1 size-4"
            />
            <span>{t("export.confirm")}</span>
          </label>
        </div>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {t("export.submit")}
        </Button>
      </div>
    </form>
  );
}
