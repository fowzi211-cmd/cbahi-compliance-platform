import { getSessionCookie } from "better-auth/cookies";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

// Pages anyone can open. Everything else needs a session.
const publicPaths = [/^\/sign-in(\/verify)?$/, /^\/sign-up$/, /^\/invite\/[^/]+$/];

/**
 * Adds the locale prefix (/ → /ar) and sends visitors without a session cookie to sign in.
 * This is only a fast first check: the cookie is not verified here. Pages verify the session
 * and services check permissions.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const match = pathname.match(/^\/(ar|en)(\/.*)?$/);
  if (match) {
    const locale = match[1];
    const rest = match[2] ?? "/";
    const isPublic = publicPaths.some((pattern) => pattern.test(rest));
    if (!isPublic && !getSessionCookie(request, { cookiePrefix: "mustamir" })) {
      const url = new URL(`/${locale}/sign-in`, request.url);
      if (rest !== "/") url.searchParams.set("next", rest);
      return NextResponse.redirect(url);
    }
  }
  return intl(request);
}

export const config = {
  // Skip API routes, Next.js internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
