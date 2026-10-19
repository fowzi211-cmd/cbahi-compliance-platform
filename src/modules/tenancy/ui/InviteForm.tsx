"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Label, Select } from "@/components/ui/input";
import type { MembershipRole } from "../domain/schemas";
import { idleState, type FormState } from "./form-state";

export function InviteForm({
  facilityId,
  roles,
  departments,
  action,
}: {
  facilityId: string;
  // Only the roles this person may hand out (see assignableRoles).
  roles: MembershipRole[];
  departments: { id: string; name: string }[];
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, idleState);
  const [role, setRole] = useState<MembershipRole>(roles.includes("staff") ? "staff" : roles[0]!);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {state.status === "error" ? (
        <Alert tone="danger" className="sm:col-span-2">
          {t(`people.errors.${state.error}` as "people.errors.generic")}
        </Alert>
      ) : null}
      {state.status === "done" ? (
        <Alert tone="success" className="sm:col-span-2">
          {t("people.invite.sent")}
        </Alert>
      ) : null}
      <input type="hidden" name="facilityId" value={facilityId} />
      <Field className="sm:col-span-2">
        <Label htmlFor="invite-email">{t("auth.fields.email")}</Label>
        <Input id="invite-email" name="email" type="email" dir="ltr" required autoComplete="off" />
      </Field>
      <Field>
        <Label htmlFor="invite-role">{t("people.invite.role")}</Label>
        <Select
          id="invite-role"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as MembershipRole)}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label htmlFor="invite-locale">{t("people.invite.language")}</Label>
        <Select id="invite-locale" name="locale" defaultValue={locale}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </Select>
      </Field>
      {role === "department_head" || role === "staff" ? (
        <Field className="sm:col-span-2">
          <Label htmlFor="invite-department">{t("people.invite.department")}</Label>
          <Select
            id="invite-department"
            name="departmentId"
            required={role === "department_head"}
            defaultValue=""
            aria-describedby="invite-department-hint"
          >
            <option value="">{t("people.invite.noDepartment")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <FieldHint id="invite-department-hint">
            {departments.length === 0
              ? t("people.invite.noDepartmentsYet")
              : t("people.invite.departmentHint")}
          </FieldHint>
        </Field>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {t("people.invite.submit")}
        </Button>
      </div>
    </form>
  );
}
