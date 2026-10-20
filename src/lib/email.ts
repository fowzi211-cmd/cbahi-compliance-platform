import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

// Outgoing email behind a small adapter, so production can switch to a regional provider
// (docs/ARCHITECTURE.md §0, decision 2). Notifications (M10) will build on this.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  // `ar` messages are sent right-to-left.
  locale: "ar" | "en";
};

// Integration tests use the in-memory transport and read what was "sent" from here.
export const memoryOutbox: EmailMessage[] = [];

let transporter: Transporter | undefined;

export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = env();
  if (config.EMAIL_TRANSPORT === "memory") {
    memoryOutbox.push(message);
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: { "Content-Language": message.locale },
  });
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A minimal, accessible HTML body with the right direction for the language. */
export function renderEmailHtml(
  locale: "ar" | "en",
  parts: { paragraphs: string[]; action?: { label: string; url: string } },
): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const paragraphs = parts.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const action = parts.action
    ? `<p><a href="${escapeHtml(parts.action.url)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#ffffff;border-radius:6px;text-decoration:none">${escapeHtml(parts.action.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.6;color:#111827">${paragraphs}${action}</body></html>`;
}
