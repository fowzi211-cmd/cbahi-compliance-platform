import { routing, type Locale } from "@/i18n/routing";
import { RateLimitedError } from "@/lib/errors";
import { requireAppContext } from "@/lib/session";
import { getDownloadUrl } from "@/modules/documents/service";

// Downloads go through here so the five-minute signed URL is minted only after the
// permission check, at the moment someone clicks, and never sits in a rendered page.
export async function GET(
  _: Request,
  { params }: RouteContext<"/[locale]/documents/versions/[versionId]/download">,
) {
  const { locale, versionId } = await params;
  const lang = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
  const ctx = await requireAppContext(lang);
  let url: string | null;
  try {
    url = await getDownloadUrl(ctx.access, versionId);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    return new Response("Too many downloads. Try again later.", {
      status: 429,
      headers: { "retry-after": String(error.retryAfterSeconds), "cache-control": "no-store" },
    });
  }
  if (!url) return new Response("Not found", { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { location: url, "cache-control": "no-store" },
  });
}
