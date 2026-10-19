/**
 * A post-sign-in destination taken from the query string. Only same-site paths are allowed,
 * so a crafted link cannot bounce someone to another site after they sign in.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
