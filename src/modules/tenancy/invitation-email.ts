import { createTranslator } from "next-intl";
import { env } from "@/lib/env";
import { renderEmailHtml, sendEmail } from "@/lib/email";
import ar from "../../../messages/ar.json";
import en from "../../../messages/en.json";
import type { MembershipRole } from "./domain/schemas";

const catalogues = { ar, en } as const;

/** Sends the invitation link in the language the inviter chose for the invitee. */
export async function sendInvitationEmail(input: {
  to: string;
  locale: "ar" | "en";
  token: string;
  role: MembershipRole;
  facilityName: string;
  inviterName: string;
}) {
  const t = createTranslator({ locale: input.locale, messages: catalogues[input.locale] });
  const url = `${env().APP_URL}/${input.locale}/invite/${input.token}`;
  const values = {
    inviter: input.inviterName,
    facility: input.facilityName,
    role: t(`roles.${input.role}`),
  };
  const paragraphs = [
    t("email.invitation.greeting"),
    t("email.invitation.body", values),
    t("email.invitation.expiry"),
    t("email.invitation.ignore"),
  ];
  await sendEmail({
    to: input.to,
    locale: input.locale,
    subject: t("email.invitation.subject", values),
    text: [...paragraphs.slice(0, 2), url, ...paragraphs.slice(2)].join("\n\n"),
    html: renderEmailHtml(input.locale, {
      paragraphs,
      action: { label: t("email.invitation.action"), url },
    }),
  });
  return url;
}
