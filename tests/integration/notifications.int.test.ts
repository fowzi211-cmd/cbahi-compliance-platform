import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb, withSystem } from "@/lib/db";
import { toRiyadhDay } from "@/lib/dates";
import { memoryOutbox } from "@/lib/email";
import { createDocument, decideVersion } from "@/modules/documents/service";
import { runDocumentReminders } from "@/modules/documents/jobs";
import { runCapaEscalation } from "@/modules/findings/jobs";
import { createCapaItem, listFindings } from "@/modules/findings/service";
import { deliverImmediate, sendDigests } from "@/modules/notifications/jobs";
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  openNotification,
  savePreferences,
} from "@/modules/notifications/service";
import { makePdf } from "@/modules/documents/test-files";
import { setFacilityFrameworks } from "@/modules/standards/service";
import { addMembership, loadAccessContext, type AccessContext } from "@/modules/tenancy/service";
import {
  createUser,
  makeTenant,
  publishDemoEdition,
  submitDemoAssessment,
  uniqueEmail,
} from "./helpers";

// M10: notices are created by business events and daily jobs, and emailed by the worker's
// sweeps. Every job takes `now`, so these tests move the clock forward instead of waiting.
let tenant: Awaited<ReturnType<typeof makeTenant>>;
let qm: AccessContext;
let staff: AccessContext;
let qmEmail: string;
let staffEmail: string;
let findingId: string;
let documentId: string;

const DAY = 86_400_000;
const start = new Date();
const at = (days: number) => new Date(start.getTime() + days * DAY);
const day = (days: number) => toRiyadhDay(at(days));
const mailTo = (email: string) => memoryOutbox.filter((m) => m.to === email);

async function member(role: "quality_manager" | "staff", email: string, locale: "ar" | "en") {
  const user = await createUser(email, role === "staff" ? "سارة الممرضة" : "Reem QM");
  await withSystem((tx) => tx.user.update({ where: { id: user.id }, data: { locale } }));
  await addMembership(tenant.ctx, { userId: user.id, facilityId: tenant.facility.id, role });
  return (await loadAccessContext(user.id, tenant.tenant.id))!;
}

beforeAll(async () => {
  tenant = await makeTenant("Notifications");
  const { frameworkId } = await publishDemoEdition();
  await setFacilityFrameworks(tenant.ctx, tenant.facility.id, [frameworkId]);
  qmEmail = uniqueEmail("qm");
  staffEmail = uniqueEmail("staff");
  qm = await member("quality_manager", qmEmail, "en");
  staff = await member("staff", staffEmail, "ar");
  await submitDemoAssessment(tenant.ctx, tenant.facility.id, frameworkId);
  findingId = (await listFindings(tenant.ctx, tenant.facility.id))[0]!.id;

  // A policy in force, due for review in 10 days and expiring in 40.
  const created = await createDocument(tenant.ctx, tenant.facility.id, {
    type: "policy",
    titleAr: "سياسة تجريبية للتنبيهات",
    titleEn: "Demo reminder policy",
    file: { name: "p.pdf", bytes: makePdf(["Demo reminder policy", String(Math.random())]) },
    effectiveOn: day(-60),
    reviewOn: day(10),
    expiresOn: day(40),
    phiAttested: true,
  });
  await decideVersion(tenant.ctx, created.versionId, { decision: "approved" });
  documentId = created.documentId;
});

afterAll(disconnectDb);

describe("assigning an action", () => {
  it("tells the new owner in the app, and not the person who assigned it", async () => {
    await createCapaItem(tenant.ctx, findingId, {
      action: "إعادة تدريب الفريق",
      ownerUserId: staff.userId,
      dueOn: day(3),
    });
    expect(await countUnread(staff)).toBe(1);
    expect(await countUnread(tenant.ctx)).toBe(0);
    const [notice] = await listNotifications(staff, "ar");
    expect(notice).toMatchObject({
      type: "capaAssigned",
      href: `/findings/${findingId}`,
      title: expect.stringContaining("إجراء تصحيحي جديد"),
      body: expect.stringContaining("إعادة تدريب الفريق"),
    });
  });

  it("emails it at once, in the owner's language, exactly once", async () => {
    expect(await deliverImmediate(tenant.tenant.id, at(0))).toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    const [email] = mailTo(staffEmail);
    expect(email).toMatchObject({ locale: "ar", subject: expect.stringContaining("إجراء تصحيحي") });
    expect(email!.html).toContain('dir="rtl"');
    expect(email!.text).toContain(`/ar/findings/${findingId}`);
    expect(await deliverImmediate(tenant.tenant.id, at(0))).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mailTo(staffEmail)).toHaveLength(1);
  });

  it("escalates an overdue action one level at a time, each notice once", async () => {
    // Due in 3 days: nothing yet on day 3, the owner on day 4, the QM on day 10, the
    // facility owner on day 17.
    expect(await runCapaEscalation(tenant.tenant.id, at(3))).toBe(0);
    expect(await runCapaEscalation(tenant.tenant.id, at(4))).toBe(1);
    expect(await runCapaEscalation(tenant.tenant.id, at(4))).toBe(0);
    expect(await runCapaEscalation(tenant.tenant.id, at(10))).toBe(1);
    expect(await runCapaEscalation(tenant.tenant.id, at(17))).toBe(1);
    expect(await runCapaEscalation(tenant.tenant.id, at(30))).toBe(0);

    const overdue = async (ctx: AccessContext, locale: "ar" | "en") =>
      (await listNotifications(ctx, locale)).filter((n) => n.type === "capaOverdue");
    expect(await overdue(staff, "ar")).toHaveLength(1);
    const [forQm] = await overdue(qm, "en");
    expect(forQm!.body).toContain("escalated to the quality manager");
    expect(forQm!.body).toContain("إعادة تدريب الفريق");
    const [forOwner] = await overdue(tenant.ctx, "ar");
    expect(forOwner!.body).toContain("صُعِّد إلى مالك المنشأة");

    expect(await deliverImmediate(tenant.tenant.id, at(17))).toMatchObject({ sent: 3 });
    expect(mailTo(qmEmail).at(-1)).toMatchObject({
      locale: "en",
      subject: expect.stringContaining("Overdue corrective action"),
    });
  });
});

describe("document reminders and the daily digest", () => {
  it("sends nothing while a document is far from its dates", async () => {
    expect(await runDocumentReminders(tenant.tenant.id, at(0))).toBe(0);
  });

  it("collects review-due and expiring-soon notices for the digest, not for immediate email", async () => {
    // Day 11: review was due yesterday and expiry is 29 days away. Owner and QM, two each.
    expect(await runDocumentReminders(tenant.tenant.id, at(11))).toBe(4);
    expect(await runDocumentReminders(tenant.tenant.id, at(12))).toBe(0);
    const before = memoryOutbox.length;
    expect(await deliverImmediate(tenant.tenant.id, at(11))).toMatchObject({ sent: 0 });
    expect(memoryOutbox).toHaveLength(before);

    const sent = await sendDigests(tenant.tenant.id, at(11));
    expect(sent).toMatchObject({ sent: 4, failed: 0 });
    const digest = mailTo(qmEmail).at(-1)!;
    expect(digest).toMatchObject({ locale: "en", subject: "Your daily summary: 2 updates" });
    expect(digest.text).toContain("Review due: Demo reminder policy");
    expect(digest.text).toContain("Expiring soon: Demo reminder policy");
    expect(digest.html).toContain('dir="ltr"');
    const ownerDigest = mailTo(tenant.owner.email).at(-1)!;
    expect(ownerDigest.subject).toBe("ملخصك اليومي: تحديثان");
    expect(ownerDigest.text).toContain("سياسة تجريبية للتنبيهات");
    // Nothing is left for tomorrow's digest.
    expect(await sendDigests(tenant.tenant.id, at(12))).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("sends an urgent notice once the document has expired", async () => {
    expect(await runDocumentReminders(tenant.tenant.id, at(41))).toBe(2);
    const [expired] = (await listNotifications(qm, "en")).filter(
      (n) => n.type === "documentExpired",
    );
    expect(expired).toMatchObject({ href: `/documents/${documentId}` });
    expect(await deliverImmediate(tenant.tenant.id, at(41))).toMatchObject({ sent: 2 });
    expect(mailTo(qmEmail).at(-1)!.subject).toBe("Expired: Demo reminder policy");
  });
});

describe("preferences and the inbox", () => {
  it("leaves out of the digest what was already read in the app", async () => {
    await createCapaItem(tenant.ctx, findingId, {
      action: "Second action",
      ownerUserId: staff.userId,
      dueOn: day(5),
    });
    await savePreferences(staff, { emailImmediate: false, emailDigest: true });
    // Immediate email is off, so the sweep holds it for the digest...
    expect(await deliverImmediate(tenant.tenant.id, at(0))).toMatchObject({ sent: 0 });
    // ...and once read in the app it is not emailed at all.
    await markAllNotificationsRead(staff);
    expect(await countUnread(staff)).toBe(0);
    const before = mailTo(staffEmail).length;
    expect(await sendDigests(tenant.tenant.id, at(0))).toMatchObject({ sent: 0, skipped: 1 });
    expect(mailTo(staffEmail)).toHaveLength(before);
  });

  it("sends nothing by email to someone who turned email off", async () => {
    await savePreferences(staff, { emailImmediate: false, emailDigest: false });
    await createCapaItem(tenant.ctx, findingId, {
      action: "Third action",
      ownerUserId: staff.userId,
      dueOn: day(5),
    });
    expect(await deliverImmediate(tenant.tenant.id, at(0))).toMatchObject({ skipped: 1 });
    expect(await countUnread(staff)).toBe(1);
  });

  it("opens a notice: marks it read and returns its link, for its own person only", async () => {
    const [latest] = await listNotifications(staff, "ar");
    expect(await openNotification(qm, latest!.id)).toBeNull();
    expect(await openNotification(staff, latest!.id)).toBe(`/findings/${findingId}`);
    expect(await countUnread(staff)).toBe(0);
    expect(await openNotification(staff, "not-a-uuid")).toBeNull();
  });
});
