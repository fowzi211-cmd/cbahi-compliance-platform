import { z } from "zod";
import type { BrowseFilter } from "../domain/browse";

const param = (max: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.string().trim().max(max).optional().catch(undefined),
  );

const schema = z.object({
  chapter: param(64),
  department: param(64),
  esr: param(1),
  q: param(100),
});

/** Library filters from the URL. Anything malformed is ignored rather than an error. */
export function parseBrowseParams(
  searchParams: Record<string, string | string[] | undefined>,
): BrowseFilter {
  const { chapter, department, esr, q } = schema.parse(searchParams);
  return {
    chapter: chapter || undefined,
    department: department || undefined,
    esrOnly: esr === "1",
    query: q || undefined,
  };
}
