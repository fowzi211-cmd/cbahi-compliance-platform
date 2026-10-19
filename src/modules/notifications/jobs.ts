import { withTenant, type TenantContext } from "@/lib/db";
import type { AppLocale } from "@/lib/dates";
import { renderEmailHtml, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { listRecipients } from "@/modules/tenancy/service";
import {
  afterFailure,
  defaultPreferences,
  digestPlan,
  emailPlan,
  type EmailPreferences,
} from "./domain/notifications";
import * as repo from "./repo";
import { renderNotification, translatorFor, type RenderedNotification } from "./templates";

// Email delivery for one tenant at a time, run by the worker (src/worker). The notification
// table is the outbox: these sweeps send what is pending and mark it. Every function takes
// `now`, so tests drive them with a fake clock.

const batch = 200;

type Recipient = { email: string; name: string; locale: AppLocale; prefs: EmailPreferences };

async function recipientsFor(
  tx: Parameters<typeof repo.listPreferences>[0],
  ctx: TenantContext,
  userIds: string[],
) {
  const ids = [...new Set(userIds)];
  const [people, prefs] = await Promise.all([
    listRecipients(tx, ctx, ids),
    repo.listPreferences(tx, ctx.tenantId, ids),
  ]);
  const prefsBy = new Map(prefs.map((p) => [p.userId, p]));
  return new Map<string, Recipient>(
    people.map((person) => {
      const pref = prefsBy.get(person.id);
      const locale = (pref?.locale ?? person.locale) === "en" ? "en" : "ar";
      return [
        person.id,
        {
          email: person.email,
          name: person.name,
          locale,
          prefs: pref
            ? { emailImmediate: pref.emailImmediate, emailDigest: pref.emailDigest }
            : defaultPreferences,
        },
      ];
    }),
  );
}

const appLink = (locale: AppLocale, href: string) => `${env().APP_URL}/${locale}${href}`;

async function sendOne(recipient: Recipient, notice: RenderedNotification) {
  const t = translatorFor(recipient.locale);
  const paragraphs = [
    t("email.greeting", { name: recipient.name }),
    notice.body,
    t("email.footer"),
  ];
  const url = appLink(recipient.locale, notice.href);
  await sendEmail({
    to: recipient.email,
    locale: recipient.locale,
    subject: notice.title,
    text: [paragraphs[0], notice.body, url, paragraphs[2]].join("\n\n"),
    html: renderEmailHtml(recipient.locale, {
      paragraphs,
      action: { label: t("email.open"), url },
    }),
  });
}

async function sendDigest(recipient: Recipient, notices: RenderedNotification[]) {
  const t = translatorFor(recipient.locale);
  const lines = notices.map((n) => `${n.title}: ${n.body}`);
  const url = appLink(recipient.locale, "/notifications");
  const paragraphs = [
    t("email.greeting", { name: recipient.name }),
    t("email.digestIntro", { count: notices.length }),
    ...lines,
    t("email.footer"),
  ];
  await sendEmail({
    to: recipient.email,
    locale: recipient.locale,
    subject: t("email.digestSubject", { count: notices.length }),
    text: [...paragraphs.slice(0, -1), url, paragraphs.at(-1)!].join("\n\n"),
    html: renderEmailHtml(recipient.locale, {
      paragraphs,
      action: { label: t("email.openInbox"), url },
    }),
  });
}

export type DeliveryResult = { sent: number; skipped: number; failed: number };

/** Sends urgent notices now, to people who want them now. Runs every minute. */
export async function deliverImmediate(tenantId: string, now: Date): Promise<DeliveryResult> {
  const ctx: TenantContext = { tenantId, userId: null };
  return withTenant(ctx, async (tx) => {
    const pending = await repo.claimPending(tx, tenantId, "immediate", batch);
    const result = { sent: 0, skipped: 0, failed: 0 };
    if (pending.length === 0) return result;
    const recipients = await recipientsFor(
      tx,
      ctx,
      pending.map((n) => n.userId),
    );
    for (const notice of pending) {
      const recipient = recipients.get(notice.userId);
      const rendered = recipient && renderNotification(recipient.locale, notice);
      const plan = rendered
        ? emailPlan({ priority: notice.priority, read: notice.readAt !== null }, recipient.prefs)
        : "skip";
      if (plan === "holdForDigest") continue;
      if (plan === "skip") {
        await repo.markSkipped(tx, tenantId, [notice.id]);
        result.skipped += 1;
        continue;
      }
      try {
        await sendOne(recipient!, rendered!);
        await repo.markEmailed(tx, tenantId, [notice.id], now);
        result.sent += 1;
      } catch {
        // The notice stays in the app; email is retried by the next sweeps, then given up.
        await repo.markFailed(tx, tenantId, [notice.id], afterFailure(notice.emailAttempts));
        result.failed += 1;
      }
    }
    return result;
  });
}

/** One email per person with everything still pending and unread. Runs once a day. */
export async function sendDigests(tenantId: string, now: Date): Promise<DeliveryResult> {
  const ctx: TenantContext = { tenantId, userId: null };
  return withTenant(ctx, async (tx) => {
    const result = { sent: 0, skipped: 0, failed: 0 };
    for (;;) {
      const pending = await repo.claimPending(tx, tenantId, null, batch);
      if (pending.length === 0) return result;
      const recipients = await recipientsFor(
        tx,
        ctx,
        pending.map((n) => n.userId),
      );
      const byUser = Map.groupBy(pending, (n) => n.userId);
      for (const [userId, notices] of byUser) {
        const recipient = recipients.get(userId);
        const include: { id: string; rendered: RenderedNotification }[] = [];
        const skip: string[] = [];
        for (const notice of notices) {
          const rendered = recipient && renderNotification(recipient.locale, notice);
          if (
            rendered &&
            digestPlan({ read: notice.readAt !== null }, recipient.prefs) === "include"
          ) {
            include.push({ id: notice.id, rendered });
          } else {
            skip.push(notice.id);
          }
        }
        if (skip.length > 0) {
          await repo.markSkipped(tx, tenantId, skip);
          result.skipped += skip.length;
        }
        if (include.length === 0) continue;
        try {
          await sendDigest(
            recipient!,
            include.map((n) => n.rendered),
          );
          await repo.markEmailed(
            tx,
            tenantId,
            include.map((n) => n.id),
            now,
          );
          result.sent += include.length;
        } catch {
          // A failed digest is not retried today; the notices stay readable in the app.
          await repo.markSkipped(
            tx,
            tenantId,
            include.map((n) => n.id),
          );
          result.failed += include.length;
        }
      }
      if (pending.length < batch) return result;
    }
  });
}
