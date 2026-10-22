import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { Client } from "pg";
import { auth } from "@/lib/auth";
import { startOfRiyadhDay, toRiyadhDay } from "@/lib/dates";
import { withSystem } from "@/lib/db";
import {
  getAssessmentSheet,
  saveElementScore,
  startAssessment,
  submitAssessment,
} from "@/modules/assessments/service";
import { runSnapshots } from "@/modules/dashboards/jobs";
import { createDocument, decideVersion, uploadVersion } from "@/modules/documents/service";
import { makePdf } from "@/modules/documents/test-files";
import {
  addCapaEvidence,
  createCapaItem,
  listFindings,
  transitionCapaItem,
} from "@/modules/findings/service";
import { markEmailVerified, setPlatformAdmin } from "@/modules/identity/service";
import {
  assignConsultant,
  setConsultant,
  updateSubscription,
} from "@/modules/subscriptions/service";
import {
  exportMockSurveyReport,
  saveSurveyCycle,
  startMockSurvey,
} from "@/modules/surveys/service";
import { setFacilityFrameworks } from "@/modules/standards/service";
import {
  addMembership,
  completeOnboardingStep,
  createDepartment,
  createOrganization,
  loadAccessContext,
  type AccessContext,
} from "@/modules/tenancy/service";
import { createTemplate, startRun } from "@/modules/tracers/service";

// The M17 demo tenant: «مستوصف النور التجريبي» (Al-Noor Demo Polyclinic), a fictional
// polyclinic with six months of history, scored against the fictional DEMO-AMB edition.
//
// History cannot be written straight into the tables: submitted scores, approvals, closed
// actions and snapshots are immutable once written (database triggers), exactly so nobody
// can rewrite the past. So the seed *lives* the six months instead: it walks day by day
// through the same services the screens use, passing each day's time as `now`. Every rule
// (evidence for Met, ESR levels, CAPA closure, rule 7 verification, score expiry) is applied
// as it would be for a real facility.
//
// A few columns are stamped by the database with now() rather than taken from `now`
// (a finding's creation, an upload, a notification). After the walk those are moved to the
// simulated time of the step that wrote them, so the screens tell one consistent story. The
// audit log is left as written: it records honestly that the seed wrote these rows today.

export const demoCredentialsFile = path.join(process.cwd(), ".demo-credentials.json");

const DOMAIN = "demo.mustamir.example";
const PASSWORD = "Mustamir-Demo-2026";
const HISTORY_DAYS = 178;
// The framework the demo facility is assessed against (prisma/seed/demo-amb.json).
const FRAMEWORK_CODE = "DEMO-AMB";

type PersonKey =
  | "owner"
  | "quality"
  | "nursingHead"
  | "pharmacyHead"
  | "infectionHead"
  | "staff"
  | "viewer"
  | "consultant"
  | "platformAdmin";

// Fictional people. Owner, quality manager, consultant and platform admin need a second
// factor (ARCHITECTURE §6), so the seed enrolls them in TOTP and writes the secrets locally.
const people: Record<PersonKey, { local: string; name: string; mfa: boolean }> = {
  owner: { local: "owner", name: "د. خالد النور", mfa: true },
  quality: { local: "quality", name: "منى الشهري", mfa: true },
  nursingHead: { local: "nursing.head", name: "سلمى العنزي", mfa: false },
  pharmacyHead: { local: "pharmacy.head", name: "فهد القحطاني", mfa: false },
  infectionHead: { local: "infection.head", name: "ريم الزهراني", mfa: false },
  staff: { local: "staff", name: "نورة الحربي", mfa: false },
  viewer: { local: "viewer", name: "سامي الدوسري", mfa: false },
  consultant: { local: "consultant", name: "سارة المطيري", mfa: true },
  platformAdmin: { local: "platform.admin", name: "فريق منصة مستمر", mfa: true },
};

export const demoEmail = (key: PersonKey) => `${people[key].local}@${DOMAIN}`;

export type DemoCredentials = {
  password: string;
  facility: { nameAr: string; nameEn: string };
  people: Record<PersonKey, { email: string; name: string; totpSecret: string | null }>;
};

type DepartmentKey = "administration" | "nursing" | "pharmacy" | "infection_control" | "outpatient";
const departments: { key: DepartmentKey; nameAr: string; nameEn: string }[] = [
  { key: "administration", nameAr: "الإدارة", nameEn: "Administration" },
  { key: "nursing", nameAr: "التمريض", nameEn: "Nursing" },
  { key: "pharmacy", nameAr: "الصيدلية", nameEn: "Pharmacy" },
  { key: "infection_control", nameAr: "مكافحة العدوى", nameEn: "Infection control" },
  { key: "outpatient", nameAr: "العيادات الخارجية", nameEn: "Outpatient clinics" },
];

// --- The story ------------------------------------------------------------------------------
//
// Day 0 is about six months ago. The facility starts with a little over half of its elements
// met, fixes the gaps over the first three months, then loses ground in nursing when staff
// turn over (days 100 to ~150, including an ESR element for a few weeks), and recovers. Just
// before the end an ESR element in infection control lapses, so the facility ends "Not ready"
// with an open action: the ESR rule and the action plan are both visible on the dashboard.

type Element = { id: string; code: string; isEsr: boolean; departments: string[] };
type Level = "MET" | "PM" | "NM";

const unit = (salt: string, code: string) =>
  createHash("sha256").update(`${salt}:${code}`).digest().readUInt32BE(0) / 2 ** 32;

function baseLevel(element: Element): Level {
  const r = unit("base", element.code);
  if (element.isEsr) return r < 0.6 ? "MET" : "NM";
  return r < 0.45 ? "MET" : r < 0.75 ? "PM" : "NM";
}

const DIP_START = 100;
const ESR_DIP = { code: "DEMO-CARE.1.1", from: 104, to: 121 };
const ESR_LAPSE = { code: "DEMO-INF.2.1", from: 165 };
const NURSING_REVIEW_DAY = 110;

function makeModel(elements: Element[]) {
  // One gap the facility never quite closes, so one action ends overdue.
  const stuck = elements.find(
    (e) => !e.isEsr && e.departments.includes("administration") && baseLevel(e) !== "MET",
  )?.code;

  return function level(element: Element, day: number): Level {
    const { code } = element;
    if (code === ESR_LAPSE.code && day >= ESR_LAPSE.from) return "NM";
    if (code === ESR_DIP.code && day >= ESR_DIP.from && day < ESR_DIP.to) return "NM";
    if (!element.isEsr && element.departments.includes("nursing") && day >= DIP_START) {
      const recovered = 128 + Math.floor(unit("recover", code) * 25);
      if (day < recovered) return unit("deep", code) < 0.4 ? "NM" : "PM";
    }
    const base = baseLevel(element);
    if (base === "MET") return "MET";
    if (code === stuck) return "PM";
    const fixed = 8 + Math.floor(unit("fix", code) * 75);
    if (day >= fixed) return "MET";
    // Some gaps improve half way before they are closed (ESR elements are met or not).
    return base === "NM" && !element.isEsr && day >= fixed - 20 ? "PM" : base;
  };
}

// --- Clock ----------------------------------------------------------------------------------

/** Calendar arithmetic on Riyadh days ("YYYY-MM-DD"). */
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Checkpoint = { real: Date; sim: Date };

function makeClock(today: string, dbOffsetMs: number) {
  const start = addDays(today, -HISTORY_DAYS);
  const checkpoints: Checkpoint[] = [];
  return {
    start,
    checkpoints,
    day: (d: number) => addDays(start, d),
    /** The instant `hours` into simulated day `d`, Riyadh time. */
    at(d: number, hours: number) {
      return new Date(startOfRiyadhDay(addDays(start, d)).getTime() + hours * 3_600_000);
    },
    /** Notes that what the database writes from here on happened at `sim`. */
    mark(sim: Date) {
      checkpoints.push({ real: new Date(Date.now() + dbOffsetMs), sim });
      return sim;
    },
  };
}

// --- People ---------------------------------------------------------------------------------

function totpNow(secret: string) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}

/** Signs a person up through Better Auth, as the sign-up screen would, and enrolls TOTP. */
async function createPerson(key: PersonKey) {
  const person = people[key];
  const email = demoEmail(key);
  const { headers, response } = await auth().api.signUpEmail({
    body: { name: person.name, email, password: PASSWORD, locale: "ar" },
    returnHeaders: true,
  });
  const userId = response.user.id;
  await markEmailVerified(userId);
  let totpSecret: string | null = null;
  if (person.mfa) {
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const session = new Headers({ cookie });
    const enrolled = await auth().api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: session,
    });
    if (enrolled.method !== "totp") throw new Error(`No TOTP enrolment for ${email}`);
    totpSecret = new URL(enrolled.totpURI).searchParams.get("secret");
    if (!totpSecret) throw new Error(`No TOTP secret for ${email}`);
    await auth().api.verifyTOTP({ body: { code: totpNow(totpSecret) }, headers: session });
  }
  return { id: userId, email, name: person.name, totpSecret };
}

// --- The seed -------------------------------------------------------------------------------

export async function seedDemoTenant(): Promise<"created" | "exists" | "skipped"> {
  if (process.env.NODE_ENV === "production") return "skipped";
  const existing = await withSystem((tx) =>
    tx.user.findUnique({ where: { email: demoEmail("owner") } }),
  );
  if (existing) return "exists";

  const framework = await withSystem((tx) =>
    tx.framework.findFirst({ where: { code: FRAMEWORK_CODE, status: "active" } }),
  );
  if (!framework) throw new Error(`${FRAMEWORK_CODE} must be installed first.`);
  // Every element of the edition with its department types; scoring scopes come from the
  // assessment sheets themselves.
  const elements: Element[] = await withSystem((tx) =>
    tx.element.findMany({
      where: { frameworkId: framework.id },
      select: { id: true, code: true, isEsr: true, departmentTypes: true },
    }),
  ).then((rows) =>
    rows.map(({ departmentTypes, ...e }) => ({ ...e, departments: departmentTypes })),
  );
  const level = makeModel(elements);
  const byId = new Map(elements.map((e) => [e.id, e]));

  const dbNow = await withSystem((tx) => tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`);
  const clock = makeClock(toRiyadhDay(new Date()), dbNow[0]!.now.getTime() - Date.now());
  const { at, mark } = clock;
  const seedStartedAt = new Date(Date.now() + (dbNow[0]!.now.getTime() - Date.now()) - 1000);

  // Day 0: the accounts, the organization, its plan and its set-up.
  mark(at(0, 8));
  const accounts = {} as Record<PersonKey, Awaited<ReturnType<typeof createPerson>>>;
  for (const key of Object.keys(people) as PersonKey[]) accounts[key] = await createPerson(key);
  await setPlatformAdmin(accounts.platformAdmin.email, true);
  const admin = { userId: accounts.platformAdmin.id, isPlatformAdmin: true };

  mark(at(0, 9));
  const { tenant, facility } = await createOrganization(accounts.owner, {
    organizationName: "مجموعة النور الطبية التجريبية",
    facilityNameAr: "مستوصف النور التجريبي",
    facilityNameEn: "Al-Noor Demo Polyclinic",
    facilityType: "polyclinic",
  });
  const facilityId = facility.id;
  const context = async (key: PersonKey) =>
    (await loadAccessContext(accounts[key].id, tenant.id)) as AccessContext;
  let owner = await context("owner");

  // Hybrid from day 0 for a year: the software plus an assigned consultant.
  mark(at(0, 9.5));
  await updateSubscription(admin, tenant.id, {
    tier: "hybrid",
    startsOn: clock.day(0),
    endsOn: clock.day(365),
  });

  mark(at(0, 10));
  await setFacilityFrameworks(owner, facilityId, [framework.id]);
  const departmentIds = {} as Record<DepartmentKey, string>;
  for (const d of departments) {
    const created = await createDepartment(owner, {
      facilityId,
      nameAr: d.nameAr,
      nameEn: d.nameEn,
      typeCode: d.key,
    });
    departmentIds[d.key] = created.id;
  }
  const memberships: [PersonKey, string, DepartmentKey | null][] = [
    ["quality", "quality_manager", null],
    ["nursingHead", "department_head", "nursing"],
    ["pharmacyHead", "department_head", "pharmacy"],
    ["infectionHead", "department_head", "infection_control"],
    ["staff", "staff", "outpatient"],
    ["viewer", "viewer", null],
  ];
  for (const [key, role, department] of memberships) {
    await addMembership(owner, {
      userId: accounts[key].id,
      facilityId,
      role: role as "staff",
      departmentId: department ? departmentIds[department] : undefined,
    });
  }
  owner = await context("owner");
  const today = toRiyadhDay(new Date());
  await saveSurveyCycle(
    owner,
    facilityId,
    {
      status: "accredited",
      lastSurveyOn: addDays(today, 75 - 3 * 365),
      nextExpectedOn: addDays(today, 75),
    },
    at(0, 11),
  );
  for (const step of [
    "facility",
    "frameworks",
    "applicability",
    "departments",
    "people",
    "survey",
  ] as const) {
    await completeOnboardingStep(owner, facilityId, step, at(0, 11));
  }

  mark(at(0, 12));
  await setConsultant(admin, accounts.consultant.email, true, at(0, 12));
  await assignConsultant(admin, tenant.id, facilityId, accounts.consultant.id, at(0, 12));

  const ctx = {
    owner,
    quality: await context("quality"),
    nursingHead: await context("nursingHead"),
    pharmacyHead: await context("pharmacyHead"),
    infectionHead: await context("infectionHead"),
    staff: await context("staff"),
    consultant: await context("consultant"),
  };

  // Who owns the corrective action for an element, by the departments it belongs to.
  const actionOwner = (element: Element): keyof typeof ctx => {
    const d = element.departments;
    if (d.includes("pharmacy")) return "pharmacyHead";
    if (d.includes("infection_control")) return "infectionHead";
    if (d.includes("nursing")) return "nursingHead";
    if (d.includes("outpatient")) return "staff";
    return "quality";
  };

  // --- Scoring ------------------------------------------------------------------------------

  async function score(
    who: AccessContext,
    assessmentId: string,
    day: number,
    hours: [number, number],
    strict = false,
  ) {
    const sheet = await getAssessmentSheet(who, assessmentId);
    const scope = scoredElements(sheet);
    for (const [i, item] of scope.entries()) {
      const element = byId.get(item.id)!;
      let found = level(element, day);
      // The consultant reads a few "met" elements more strictly than the team does.
      if (strict && found === "MET" && !element.isEsr && unit("strict", element.code) < 0.15) {
        found = "PM";
      }
      const when = at(day, hours[0] + ((hours[1] - hours[0]) * i) / scope.length);
      mark(when);
      await saveElementScore(
        who,
        assessmentId,
        item.id,
        {
          levelCode: found,
          comment: comments[found],
          evidence: found === "NM" ? null : { kind: "observation", note: observations[found] },
        },
        when,
      );
    }
    const submitted = at(day, hours[1]);
    mark(submitted);
    await submitAssessment(who, assessmentId, submitted);
  }

  // --- Corrective actions -------------------------------------------------------------------

  type OpenAction = {
    itemId: string;
    code: string;
    owner: keyof typeof ctx;
    closeOn: number | null;
    closed: boolean;
  };
  const actions: OpenAction[] = [];

  /** The first day from `from` on when the element is met again, if it is within the story. */
  const metAgainOn = (element: Element, from: number) => {
    for (let d = from; d < HISTORY_DAYS; d++) if (level(element, d) === "MET") return d;
    return null;
  };

  /** The quality manager plans one action for every new finding that has none yet. */
  async function planActions(day: number, hours: number) {
    const when = mark(at(day, hours));
    const findings = await listFindings(ctx.quality, facilityId, { status: "open" }, when);
    for (const finding of findings.filter((f) => f.capa.total === 0)) {
      const element = byId.get(finding.element.id);
      // A gap that a later check found again already has its action under way.
      if (!element || actions.some((a) => a.code === element.code && !a.closed)) continue;
      const closeOn = metAgainOn(element, day + 1);
      const due = day + 21 + Math.floor(unit("due", element.code) * 35);
      const ownerKey = actionOwner(element);
      const { id } = await createCapaItem(
        ctx.quality,
        finding.id,
        {
          action: `معالجة فجوة ${element.code}: تحديث الإجراء وتدريب الفريق والتحقق بالملاحظة`,
          ownerUserId: accounts[ownerKey].id,
          dueOn: clock.day(due),
        },
        when,
      );
      actions.push({ itemId: id, code: element.code, owner: ownerKey, closeOn, closed: false });
    }
  }

  /** Owners close the actions whose fix lands today, with evidence and a closure note. */
  async function closeActions(day: number) {
    for (const action of actions.filter((a) => a.closeOn === day)) {
      const when = mark(at(day, 8));
      const who = ctx[action.owner];
      await transitionCapaItem(who, action.itemId, { transition: "start" }, when);
      await addCapaEvidence(
        who,
        action.itemId,
        {
          kind: "link",
          url: `https://intranet.al-noor.demo.example/capa/${action.itemId.slice(0, 8)}`,
          description: "سجل التدريب وقائمة التحقق بعد التطبيق",
        },
        when,
      );
      await transitionCapaItem(
        who,
        action.itemId,
        { transition: "complete", note: "طُبّق الإجراء وتحققنا منه في الموقع." },
        when,
      );
      action.closed = true;
    }
    // The ESR lapse at the end: the owner has started, not finished.
    for (const action of actions.filter((a) => a.closeOn === null && a.owner === "infectionHead")) {
      if (day !== HISTORY_DAYS - 1) continue;
      await transitionCapaItem(
        ctx.infectionHead,
        action.itemId,
        { transition: "start" },
        mark(at(day, 9)),
      );
    }
  }

  // --- Documents ----------------------------------------------------------------------------

  async function addDocument(
    day: number,
    doc: (typeof documents)[number],
    approve = true,
  ): Promise<string> {
    const uploaded = mark(at(day, 10));
    const { documentId, versionId } = await createDocument(
      ctx.quality,
      facilityId,
      {
        type: doc.type,
        titleAr: doc.titleAr,
        titleEn: doc.titleEn,
        departmentId: doc.department ? departmentIds[doc.department] : null,
        file: { name: doc.file, bytes: makePdf([doc.titleEn, "Fictional demo document."]) },
        effectiveOn: clock.day(day),
        reviewOn: doc.reviewIn === null ? null : addDays(today, doc.reviewIn),
        expiresOn: doc.expiresIn === null ? null : addDays(today, doc.expiresIn),
        changeNote: "الإصدار الأول",
        phiAttested: true,
      },
      uploaded,
    );
    if (approve) {
      const approved = mark(at(day, 14));
      await decideVersion(ctx.owner, versionId, { decision: "approved" }, approved);
    }
    return documentId;
  }

  // --- Tracers ------------------------------------------------------------------------------

  const tracers: { id: string; who: keyof typeof ctx; first: number; every: number }[] = [];

  // --- The walk -----------------------------------------------------------------------------

  const fullAssessmentDays = [3, 90, 168];
  let pharmacyProcedure = "";

  for (let day = 0; day < HISTORY_DAYS; day++) {
    if (day === 1) {
      for (const doc of documents.slice(0, 6)) {
        const id = await addDocument(1, doc);
        if (doc.file === "high-alert-medicines.pdf") pharmacyProcedure = id;
      }
    }

    await closeActions(day);

    if (fullAssessmentDays.includes(day)) {
      const id = await startAssessment(
        ctx.quality,
        facilityId,
        { frameworkId: framework.id },
        mark(at(day, 8)),
      );
      await score(ctx.quality, id, day, [8.5, 15]);
      await planActions(day, 16);
    }

    // Tracers showed nursing slipping, so the quality manager assesses the whole department.
    if (day === NURSING_REVIEW_DAY) {
      const id = await startAssessment(
        ctx.quality,
        facilityId,
        { frameworkId: framework.id, departmentId: departmentIds.nursing },
        mark(at(day, 8)),
      );
      await score(ctx.quality, id, day, [8.5, 13]);
      await planActions(day, 14);
    }

    if (day === 7) {
      const when = mark(at(7, 11));
      const templates: [
        keyof typeof ctx,
        string,
        string,
        DepartmentKey | null,
        number,
        "weekly" | "monthly",
        number,
      ][] = [
        [
          "nursingHead",
          "جولة التمريض الأسبوعية",
          "Weekly nursing tracer",
          "nursing",
          4,
          "weekly",
          10,
        ],
        [
          "pharmacyHead",
          "جولة الصيدلية الأسبوعية",
          "Weekly pharmacy tracer",
          "pharmacy",
          3,
          "weekly",
          12,
        ],
        ["quality", "جولة الجودة الأسبوعية", "Weekly quality walk", null, 5, "weekly", 14],
        [
          "infectionHead",
          "جولة مكافحة العدوى الشهرية",
          "Monthly infection control tracer",
          "infection_control",
          4,
          "monthly",
          20,
        ],
      ];
      for (const [who, nameAr, nameEn, department, sampleSize, frequency, first] of templates) {
        const id = await createTemplate(
          ctx.quality,
          facilityId,
          {
            nameAr,
            nameEn,
            frameworkId: framework.id,
            departmentId: department ? departmentIds[department] : null,
            sampleSize,
            frequency,
            assigneeUserId: accounts[who].id,
          },
          when,
        );
        tracers.push({ id, who, first, every: frequency === "weekly" ? 7 : 30 });
      }
    }

    for (const tracer of tracers) {
      if (day < tracer.first || (day - tracer.first) % tracer.every !== 0) continue;
      if (fullAssessmentDays.includes(day)) continue;
      const who = ctx[tracer.who];
      const runId = await startRun(
        who,
        tracer.id,
        mark(at(day, 10)),
        createHash("sha256").update(`${tracer.id}:${day}`).digest("hex").slice(0, 32),
      );
      await score(who, runId, day, [10.25, 11.5]);
      await planActions(day, 12);
    }

    if (day === 100) {
      const uploaded = mark(at(100, 10));
      const { versionId } = await uploadVersion(
        ctx.pharmacyHead,
        pharmacyProcedure,
        {
          file: {
            name: "high-alert-medicines-v2.pdf",
            bytes: makePdf(["High-alert medicines dispensing, version 2", "Fictional demo."]),
          },
          effectiveOn: clock.day(101),
          reviewOn: addDays(today, 270),
          expiresOn: null,
          changeNote: "إضافة التحقق المزدوج قبل الصرف",
          phiAttested: true,
        },
        uploaded,
      );
      await decideVersion(ctx.quality, versionId, { decision: "approved" }, mark(at(100, 15)));
    }

    if (day === 150) {
      const id = await startMockSurvey(
        ctx.consultant,
        facilityId,
        { frameworkId: framework.id },
        mark(at(150, 9)),
      );
      await score(ctx.consultant, id, 150, [9.25, 15], true);
      try {
        await exportMockSurveyReport(ctx.consultant, id, { phiAttested: true }, mark(at(150, 16)));
      } catch (error) {
        // Printing needs a browser (PDF_RENDERER). The survey stands without its report.
        console.warn("The demo mock survey report was not printed:", (error as Error).message);
      }
      await planActions(150, 17);
    }

    if (day === 170) await addDocument(170, documents[6]!, false);

    // The trend starts with the first assessment: before it there is nothing to show.
    if (day >= fullAssessmentDays[0]!) {
      await runSnapshots(tenant.id, mark(at(day, 23 + 50 / 60)));
    }
  }
  await runSnapshots(tenant.id, new Date());

  await backdate(tenant.id, clock.checkpoints, seedStartedAt, Object.values(accounts));

  const credentials: DemoCredentials = {
    password: PASSWORD,
    facility: { nameAr: "مستوصف النور التجريبي", nameEn: "Al-Noor Demo Polyclinic" },
    people: Object.fromEntries(
      (Object.keys(people) as PersonKey[]).map((key) => [
        key,
        {
          email: accounts[key].email,
          name: accounts[key].name,
          totpSecret: accounts[key].totpSecret,
        },
      ]),
    ) as DemoCredentials["people"],
  };
  await writeFile(demoCredentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  return "created";
}

const comments: Record<Level, string> = {
  MET: "مطبّق بالكامل ومُثبت بالأدلة.",
  PM: "مطبّق جزئيًا: بعض السجلات ناقصة.",
  NM: "غير مطبّق: لا توجد ممارسة موثقة.",
};
const observations: Record<Exclude<Level, "NM">, string> = {
  MET: "لوحظت الممارسة في الموقع وراجعنا عينة من السجلات.",
  PM: "لوحظت الممارسة في جزء من الأقسام فقط.",
};

// Fictional documents. Two of them come up for review or expiry soon, so the dashboard's
// document alerts have something to show.
const documents: {
  type: "policy" | "procedure" | "form" | "plan";
  titleAr: string;
  titleEn: string;
  department: DepartmentKey | null;
  file: string;
  reviewIn: number | null;
  expiresIn: number | null;
}[] = [
  {
    type: "policy",
    titleAr: "سياسة نظافة اليدين",
    titleEn: "Hand hygiene policy",
    department: "infection_control",
    file: "hand-hygiene-policy.pdf",
    reviewIn: 20,
    expiresIn: null,
  },
  {
    type: "procedure",
    titleAr: "إجراء صرف الأدوية عالية الخطورة",
    titleEn: "High-alert medicines dispensing procedure",
    department: "pharmacy",
    file: "high-alert-medicines.pdf",
    reviewIn: 180,
    expiresIn: null,
  },
  {
    type: "plan",
    titleAr: "خطة الاستجابة للطوارئ",
    titleEn: "Emergency response plan",
    department: null,
    file: "emergency-response-plan.pdf",
    reviewIn: 200,
    expiresIn: null,
  },
  {
    type: "form",
    titleAr: "نموذج تسليم المناوبة التمريضية",
    titleEn: "Nursing shift handover form",
    department: "nursing",
    file: "nursing-handover-form.pdf",
    reviewIn: 300,
    expiresIn: null,
  },
  {
    type: "policy",
    titleAr: "سياسة تحسين الجودة وسلامة المرضى",
    titleEn: "Quality improvement and patient safety policy",
    department: null,
    file: "quality-policy.pdf",
    reviewIn: 240,
    expiresIn: null,
  },
  {
    type: "procedure",
    titleAr: "إجراء تنظيف الأدوات وتعقيمها",
    titleEn: "Instrument cleaning and sterilization procedure",
    department: "infection_control",
    file: "instrument-sterilization.pdf",
    reviewIn: null,
    expiresIn: 10,
  },
  {
    type: "procedure",
    titleAr: "إجراء مواعيد العيادات الخارجية",
    titleEn: "Outpatient appointments procedure",
    department: "outpatient",
    file: "outpatient-appointments.pdf",
    reviewIn: 365,
    expiresIn: null,
  },
];

type Sheet = Awaited<ReturnType<typeof getAssessmentSheet>>;

function scoredElements(sheet: Sheet) {
  if (!sheet) throw new Error("Assessment not found.");
  return sheet.chapters.flatMap((c) =>
    c.standards.flatMap((s) => s.elements.map((e) => ({ id: e.id, code: e.code, isEsr: e.isEsr }))),
  );
}

/**
 * Moves the timestamps the database stamped with now() during the walk to the simulated time
 * of the step that wrote them. Runs as the database owner with triggers off, because several
 * of these rows are immutable by design. Audit events are left alone: their time is part of
 * the hash chain, and they truthfully say when the seed wrote the history.
 */
async function backdate(
  tenantId: string,
  checkpoints: Checkpoint[],
  since: Date,
  users: { id: string }[],
) {
  const client = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "CREATE TEMP TABLE demo_clock (real timestamptz NOT NULL, sim timestamptz NOT NULL) ON COMMIT DROP",
    );
    await client.query(
      "INSERT INTO demo_clock SELECT * FROM unnest($1::timestamptz[], $2::timestamptz[])",
      [checkpoints.map((c) => c.real.toISOString()), checkpoints.map((c) => c.sim.toISOString())],
    );
    const { rows: columns } = await client.query<{ table_name: string; column_name: string }>(`
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.columns t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.column_name = 'tenant_id'
      WHERE c.table_schema = 'public' AND c.data_type = 'timestamp with time zone'
        AND c.table_name NOT IN ('audit_event', 'compliance_snapshot')`);
    const shift = (column: string) => `(
      SELECT k.sim + (${column} - k.real) FROM demo_clock k
      WHERE k.real <= ${column} ORDER BY k.real DESC LIMIT 1)`;
    for (const { table_name: table, column_name: column } of columns) {
      const col = `"${column}"`;
      await client.query(
        `UPDATE "${table}" SET ${col} = coalesce(${shift(col)}, ${col})
         WHERE tenant_id = $1 AND ${col} >= $2`,
        [tenantId, since.toISOString()],
      );
    }
    await client.query(
      `UPDATE app_user SET created_at = (SELECT min(sim) FROM demo_clock) WHERE id = ANY($1::uuid[])`,
      [users.map((u) => u.id)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
