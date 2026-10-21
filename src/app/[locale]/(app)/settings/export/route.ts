import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { env } from "@/lib/env";
import { ForbiddenError, RateLimitedError } from "@/lib/errors";
import { requireAppContext } from "@/lib/session";
import { exportTenantData } from "@/modules/governance/service";

// The organization's data export (PDPL portability, ARCHITECTURE §6). A POST from the
// settings page; the ZIP is streamed back as an attachment, so the page stays where it is.
// When the export is refused, the browser goes back to settings with the reason.
export async function POST(
  request: Request,
  { params }: RouteContext<"/[locale]/settings/export">,
) {
  const { locale } = await params;
  const lang = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  // Session cookies are SameSite=Lax, which already keeps cross-site form posts out; the
  // origin check is a second line for a request that changes the audit log.
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(env().APP_URL).origin &&
    origin !== new URL(request.url).origin
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const ctx = await requireAppContext(lang);
  const back = (reason: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `${getPathname({ href: "/settings", locale: lang })}?export=${reason}#export`,
        "cache-control": "no-store",
      },
    });
  try {
    const { fileName, bytes } = await exportTenantData(ctx.access);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(bytes.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RateLimitedError) return back("rateLimited");
    if (error instanceof ForbiddenError) return back("forbidden");
    throw error;
  }
}
