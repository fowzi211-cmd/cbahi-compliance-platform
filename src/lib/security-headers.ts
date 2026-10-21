// Response headers for every route (ARCHITECTURE §6, M16), set in next.config.ts.
//
// The Content Security Policy allows inline scripts: Next.js streams each page's data as inline
// <script> tags, and a nonce would need every page rendered per request, which Partial
// Prerendering (cacheComponents) rules out. What the policy still guarantees: scripts, styles,
// fonts and connections come only from this origin; no plugins, no <base> rewriting, forms post
// only here and no other site can frame the app. React escapes everything it renders, which is
// the main defence against injected markup.

export type SecurityHeaderOptions = {
  // Served over https: adds HSTS and upgrades stray http subresources.
  https: boolean;
  // `next dev` evaluates code for its error overlay and needs `unsafe-eval`.
  dev: boolean;
};

export function contentSecurityPolicy({ https, dev }: SecurityHeaderOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Older browsers that ignore frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    // Invitation links carry their token in the path: never send it to another site.
    { key: "Referrer-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(options.https
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
      : []),
  ];
}
