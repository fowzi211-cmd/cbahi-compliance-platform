import { withTenant } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import {
  evaluateCompliance,
  listCurrentCitations,
  readyScore,
} from "@/modules/assessments/service";
import { getDocumentAlerts } from "@/modules/documents/service";
import { getSurveyCycle } from "@/modules/surveys/service";
import { allowed, getFacility, type AccessContext } from "@/modules/tenancy/service";
import { surveyCountdown } from "./domain/countdown";
import { trendPoints, windowStart, type TrendSeries } from "./domain/trend";
import * as repo from "./repo";

export type { CountdownState } from "./domain/countdown";
export type { TrendPoint } from "./domain/trend";
export { readyScore };

/** How many unverified elements the overview names; the rest are counted. */
export const unverifiedListLimit = 10;

/**
 * The readiness overview (ROADMAP M13). Facility-wide viewers (owner, quality manager,
 * consultant, viewer) see everything; someone whose dashboard is limited to a department
 * (department head, staff) sees the scores of their own departments only, because
 * facility readiness is a facility-level verdict (§6). Null when the caller sees nothing.
 */
export async function getDashboard(ctx: AccessContext, facilityId: string, now = new Date()) {
  const facility = await getFacility(ctx, facilityId);
  if (!facility) return null;
  const wholeFacility = allowed(ctx, "dashboard.view", { facilityId, departmentId: null });
  const results = await withTenant(ctx, (tx) => evaluateCompliance(tx, ctx, facility, now));
  const visibleDepartments = new Set(
    results
      .flatMap((r) => r.departments)
      .filter((d) => allowed(ctx, "dashboard.view", { facilityId, departmentId: d.id }))
      .map((d) => d.id),
  );
  if (!wholeFacility && visibleDepartments.size === 0) return null;

  const frameworks = results.map((r) => {
    const elementById = new Map(r.elements.map((e) => [e.id, e]));
    const departmentById = new Map(r.departments.map((d) => [d.id, d]));
    const chapterById = new Map(r.chapters.map((c) => [c.id, c]));
    const departments = r.internal.departments
      .filter((d) => visibleDepartments.has(d.departmentId) && d.counted > 0)
      .map((d) => ({ ...d, department: departmentById.get(d.departmentId)! }));
    if (!wholeFacility) return { framework: r.framework, departments, overview: null };
    // ESR first: a facility that misses one is not ready whatever else it scores.
    const unverified = [...r.internal.unverified].sort((a, b) => Number(b.isEsr) - Number(a.isEsr));
    return {
      framework: r.framework,
      departments,
      overview: {
        status: r.internal.status,
        reasons: r.internal.reasons,
        facility: r.internal.facility,
        expired: r.internal.expired,
        chapters: r.internal.chapters.map((c) => ({
          ...c,
          chapter: chapterById.get(c.chapterId)!,
        })),
        esr: r.internal.esr.map((e) => ({ ...e, element: elementById.get(e.elementId)! })),
        unverified: unverified
          .slice(0, unverifiedListLimit)
          .map((u) => ({ ...u, element: elementById.get(u.elementId)! })),
        unverifiedTotal: unverified.length,
        consultant: r.consultant
          ? { status: r.consultant.status, score: r.consultant.facility.score }
          : null,
      },
    };
  });

  if (!wholeFacility) {
    return { scope: "departments" as const, frameworks, facilityWide: null };
  }

  const [documents, citations, cycle] = await Promise.all([
    getDocumentAlerts(ctx, facilityId, now),
    listCurrentCitations(ctx, facilityId),
    getSurveyCycle(ctx, facilityId),
  ]);
  // Elements whose score in force leans on a document that has since expired: the score
  // still counts until it expires itself, but a surveyor will ask for the current document.
  const expiredVersions = new Map(documents.expired.map((d) => [d.versionId, d]));
  const elements = new Map(results.flatMap((r) => r.elements).map((e) => [e.id, e]));
  const expiredEvidence = citations
    .filter((c) => expiredVersions.has(c.versionId) && elements.has(c.elementId))
    .map((c) => ({
      element: elements.get(c.elementId)!,
      document: expiredVersions.get(c.versionId)!,
    }));

  return {
    scope: "facility" as const,
    frameworks,
    facilityWide: {
      capa: results[0]?.capa ?? null,
      documents,
      expiredEvidence,
      survey: {
        status: cycle?.status ?? "never_surveyed",
        nextExpectedOn: cycle?.nextExpectedOn ?? null,
        ...surveyCountdown(cycle?.nextExpectedOn ?? null, toRiyadhDay(now)),
      },
    },
  };
}
export type Dashboard = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;

export const trendWindowDays = 180;

/**
 * The trend per edition from the nightly snapshots of the last `trendWindowDays` days,
 * internal and consultant side by side. Facility-wide viewers only.
 */
export async function getTrend(ctx: AccessContext, facilityId: string, now = new Date()) {
  if (!allowed(ctx, "dashboard.view", { facilityId, departmentId: null })) return [];
  if (!(await getFacility(ctx, facilityId))) return [];
  const from = new Date(`${windowStart(toRiyadhDay(now), trendWindowDays)}T00:00:00Z`);
  const rows = await withTenant(ctx, (tx) =>
    repo.listSnapshots(tx, ctx.tenantId, facilityId, from),
  );
  const byFramework = new Map<
    string,
    { day: string; series: TrendSeries; score: number | null }[]
  >();
  for (const row of rows) {
    const list = byFramework.get(row.frameworkId) ?? [];
    list.push({
      day: row.day.toISOString().slice(0, 10),
      series: row.series,
      score: row.score === null ? null : Number(row.score),
    });
    byFramework.set(row.frameworkId, list);
  }
  return [...byFramework.entries()].map(([frameworkId, list]) => ({
    frameworkId,
    points: trendPoints(list),
  }));
}
export type FrameworkTrend = Awaited<ReturnType<typeof getTrend>>[number];
