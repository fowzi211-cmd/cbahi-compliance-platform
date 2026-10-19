import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectDb } from "@/lib/db";
import { memoryOutbox } from "@/lib/email";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { listAuditEvents } from "@/modules/audit/service";
import {
  acceptInvitation,
  createDepartment,
  findInvitationByToken,
  inviteMember,
  listOpenInvitations,
  listUserMemberships,
  loadAccessContext,
  revokeInvitation,
  type AccessContext,
} from "@/modules/tenancy/service";
import { createUser, makeTenant, uniqueEmail } from "./helpers";

let t: Awaited<ReturnType<typeof makeTenant>>;
let departmentId: string;

beforeAll(async () => {
  t = await makeTenant("Invitations");
  departmentId = (
    await createDepartment(t.ctx, { facilityId: t.facility.id, nameAr: "طوارئ", nameEn: "ER" })
  ).id;
});

afterAll(disconnectDb);

const rejectsWith = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
};

/** Invites `role`, accepts as a fresh user and returns that user's access context. */
async function joinAs(role: "quality_manager" | "staff", inviter: AccessContext = t.ctx) {
  const email = uniqueEmail(role);
  const { token } = await inviteMember(inviter, { facilityId: t.facility.id, email, role });
  const user = await createUser(email);
  await acceptInvitation(token, user);
  return (await loadAccessContext(user.id, t.tenant.id))!;
}

describe("inviting", () => {
  it("emails a link in the chosen language and stores only the token's hash", async () => {
    const email = uniqueEmail("nurse");
    const { token, invitation } = await inviteMember(t.ctx, {
      facilityId: t.facility.id,
      email,
      role: "staff",
      locale: "en",
    });
    const sent = memoryOutbox.findLast((m) => m.to === email)!;
    expect(sent.locale).toBe("en");
    expect(sent.subject).toBe("Invitation to join Facility Invitations on Mustamir");
    expect(sent.text).toContain(`/en/invite/${token}`);
    expect(sent.html).toContain('dir="ltr"');
    expect(invitation).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(await listAuditEvents(t.ctx, { entity: "invitation" }))).not.toContain(
      token,
    );
  });

  it("sends Arabic by default, right-to-left", async () => {
    const email = uniqueEmail("ar");
    await inviteMember(t.ctx, { facilityId: t.facility.id, email, role: "viewer" });
    const sent = memoryOutbox.findLast((m) => m.to === email)!;
    expect(sent.subject).toBe("دعوة للانضمام إلى منشأة Invitations على مستمر");
    expect(sent.html).toContain('dir="rtl"');
  });

  it("revokes the earlier link when the same person is invited again", async () => {
    const email = uniqueEmail("twice");
    const first = await inviteMember(t.ctx, { facilityId: t.facility.id, email, role: "staff" });
    const second = await inviteMember(t.ctx, { facilityId: t.facility.id, email, role: "staff" });
    expect((await findInvitationByToken(first.token))?.status).toBe("revoked");
    expect((await findInvitationByToken(second.token))?.status).toBe("pending");
  });

  it("requires a department of this facility for a department head", async () => {
    const email = uniqueEmail("head");
    await expect(
      inviteMember(t.ctx, { facilityId: t.facility.id, email, role: "department_head" }),
    ).rejects.toThrow();
    await rejectsWith(
      inviteMember(t.ctx, {
        facilityId: t.facility.id,
        email,
        role: "department_head",
        departmentId: "00000000-0000-7000-8000-000000000000",
      }),
      "unknownDepartment",
    );
    await inviteMember(t.ctx, {
      facilityId: t.facility.id,
      email,
      role: "department_head",
      departmentId,
    });
  });
});

describe("who may invite whom", () => {
  it("lets a quality manager invite staff but not owners or quality managers", async () => {
    const qm = await joinAs("quality_manager");
    await inviteMember(qm, { facilityId: t.facility.id, email: uniqueEmail("s"), role: "staff" });
    for (const role of ["facility_owner", "quality_manager"] as const) {
      await expect(
        inviteMember(qm, { facilityId: t.facility.id, email: uniqueEmail("x"), role }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("does not let staff invite anyone or see invitations", async () => {
    const staff = await joinAs("staff");
    await expect(
      inviteMember(staff, { facilityId: t.facility.id, email: uniqueEmail("x"), role: "viewer" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOpenInvitations(staff, t.facility.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("accepting", () => {
  it("creates the membership with the invited role, once, and audits it", async () => {
    const email = uniqueEmail("joiner");
    const { token, invitation } = await inviteMember(t.ctx, {
      facilityId: t.facility.id,
      email,
      role: "staff",
      departmentId,
    });
    const user = await createUser(email);
    // Case differences in the signed-in email do not matter.
    await acceptInvitation(token, { id: user.id, email: email.toUpperCase() });

    const memberships = await listUserMemberships(user.id);
    expect(memberships).toEqual([
      expect.objectContaining({ facilityId: t.facility.id, departmentId, role: "staff" }),
    ]);
    const events = (
      await listAuditEvents(t.ctx, { entity: "invitation", entityId: invitation.id })
    ).sort((x, y) => x.chainSeq - y.chainSeq);
    expect(events.map((e) => e.action)).toEqual(["create", "accept"]);
    expect(events[1]!.actorUserId).toBe(user.id);

    await rejectsWith(acceptInvitation(token, user), "accepted");
    expect(await listUserMemberships(user.id)).toHaveLength(1);
  });

  it("refuses someone signed in with a different email", async () => {
    const { token } = await inviteMember(t.ctx, {
      facilityId: t.facility.id,
      email: uniqueEmail("intended"),
      role: "staff",
    });
    const other = await createUser(uniqueEmail("other"));
    await rejectsWith(acceptInvitation(token, other), "wrongEmail");
    expect(await listUserMemberships(other.id)).toEqual([]);
  });

  it("refuses expired, revoked and unknown links", async () => {
    const email = uniqueEmail("late");
    const user = await createUser(email);
    const lastMonth = new Date(Date.now() - 30 * 24 * 3_600_000);
    const expired = await inviteMember(
      t.ctx,
      { facilityId: t.facility.id, email, role: "staff" },
      lastMonth,
    );
    await rejectsWith(acceptInvitation(expired.token, user), "expired");

    const revoked = await inviteMember(t.ctx, { facilityId: t.facility.id, email, role: "viewer" });
    expect(await revokeInvitation(t.ctx, revoked.invitation.id)).toBe(true);
    await rejectsWith(acceptInvitation(revoked.token, user), "revoked");

    await rejectsWith(acceptInvitation("not-a-real-token-at-all-000000", user), "notFound");
    expect(await findInvitationByToken("not-a-real-token-at-all-000000")).toBeNull();
  });
});
