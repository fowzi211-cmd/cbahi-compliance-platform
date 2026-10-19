import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";
import type { Locale } from "@/i18n/routing";
import { formatDate } from "@/lib/dates";
import { requireAppContext } from "@/lib/session";
import {
  allowed,
  assignableRoles,
  listDepartments,
  listFacilityMembers,
  listOpenInvitations,
} from "@/modules/tenancy/service";
import { InviteForm } from "@/modules/tenancy/ui/InviteForm";
import { inviteAction, revokeInvitationAction } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/people">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "nav" });
  return { title: t("people") };
}

export default async function PeoplePage({ params }: PageProps<"/[locale]/people">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("nav.people")}</h1>
        <p className="text-muted-foreground max-w-prose">{t("people.intro")}</p>
      </div>
      <Suspense fallback={<Pending />}>
        <PeopleBody locale={locale as Locale} />
      </Suspense>
    </div>
  );
}

async function PeopleBody({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale });
  const ctx = await requireAppContext(locale);
  const facilityId = ctx.facilityId;

  if (!allowed(ctx.access, "membership.manage", { facilityId })) {
    return (
      <Card>
        <CardDescription>{t("people.forbidden")}</CardDescription>
      </Card>
    );
  }

  const [members, invitations, departments] = await Promise.all([
    listFacilityMembers(ctx.access, facilityId),
    listOpenInvitations(ctx.access, facilityId),
    listDepartments(ctx.access, facilityId),
  ]);
  const departmentName = new Map(
    departments.map((d) => [d.id, locale === "ar" ? d.nameAr : d.nameEn]),
  );

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle>{t("people.invite.title")}</CardTitle>
        <InviteForm
          facilityId={facilityId}
          roles={assignableRoles(ctx.access.actor, facilityId)}
          departments={departments.map((d) => ({ id: d.id, name: departmentName.get(d.id)! }))}
          action={inviteAction}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("people.members.title")}</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-start">
              <tr>
                <th scope="col" className="py-2 text-start font-medium">
                  {t("auth.fields.name")}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t("auth.fields.email")}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {t("people.invite.role")}
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-border border-t">
                  <td className="py-2 pe-3">{m.user.name}</td>
                  <td className="py-2 pe-3">
                    <bdi dir="ltr">{m.user.email}</bdi>
                  </td>
                  <td className="py-2" data-testid={`role-${m.user.email}`}>
                    {t(`roles.${m.role}`)}
                    {m.departmentId ? ` · ${departmentName.get(m.departmentId) ?? ""}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>{t("people.invitations.title")}</CardTitle>
        {invitations.length === 0 ? (
          <CardDescription>{t("people.invitations.empty")}</CardDescription>
        ) : (
          <ul className="flex flex-col gap-3">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3"
              >
                <div className="flex flex-col">
                  <bdi dir="ltr" className="font-medium">
                    {inv.email}
                  </bdi>
                  <span className="text-muted-foreground text-sm">
                    {t("people.invitations.details", {
                      role: t(`roles.${inv.role}`),
                      date: formatDate(inv.expiresAt, locale),
                    })}
                  </span>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <Button type="submit" variant="outline" size="sm">
                    {t("people.invitations.revoke")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
