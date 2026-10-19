import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Adds the locale prefix to every page URL (/ → /ar).
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next.js internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
