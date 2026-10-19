"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Select } from "@/components/ui/input";
import { idleState, type FormState } from "@/lib/form-state";
import { capaLimits, type CapaEvidenceKind } from "../domain/capa";

/** Attaches closure evidence: an approved document in force, or a link. */
export function EvidenceForm({
  itemId,
  documents,
  action,
}: {
  itemId: string;
  documents: { value: string; label: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations("findings");
  const [state, formAction, pending] = useActionState(action, idleState);
  const [kind, setKind] = useState<CapaEvidenceKind>(documents.length > 0 ? "document" : "link");
  const id = useId();
  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="capa-evidence-form">
      <input type="hidden" name="itemId" value={itemId} />
      {state.status === "error" ? (
        <Alert tone="danger">{t(`errors.${state.error}` as "errors.invalid")}</Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={`${id}-kind`}>{t("capa.kind")}</Label>
          <Select
            id={`${id}-kind`}
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CapaEvidenceKind)}
          >
            <option value="document">{t("capa.kinds.document")}</option>
            <option value="link">{t("capa.kinds.link")}</option>
          </Select>
        </Field>
        {kind === "document" ? (
          <Field>
            <Label htmlFor={`${id}-doc`}>{t("capa.document")}</Label>
            <Select id={`${id}-doc`} name="documentVersionId" required defaultValue="">
              <option value="" disabled>
                {documents.length > 0 ? t("capa.chooseDocument") : t("capa.noDocuments")}
              </option>
              {documents.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field>
            <Label htmlFor={`${id}-url`}>{t("capa.url")}</Label>
            <Input
              id={`${id}-url`}
              name="url"
              type="url"
              required
              dir="ltr"
              maxLength={capaLimits.url}
              placeholder="https://"
            />
          </Field>
        )}
      </div>
      <Field>
        <Label htmlFor={`${id}-desc`}>{t("capa.description")}</Label>
        <Input id={`${id}-desc`} name="description" maxLength={capaLimits.description} dir="auto" />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t("capa.addEvidence")}
        </Button>
      </div>
    </form>
  );
}
