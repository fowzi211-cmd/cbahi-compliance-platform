import { describe, expect, it } from "vitest";
import {
  actions,
  assignableRoles,
  can,
  canAssignRole,
  type Action,
  type Actor,
  type PolicyRole,
  type Resource,
} from "./policy";

// This table is a copy of the matrix in docs/ARCHITECTURE.md §6, written independently of
// `policyMatrix` so a change to one without the other fails here.
type Cell = "yes" | "no" | "ownDept" | "assigned" | "ownItem" | "internal" | "consultant";
const roles = [
  "facility_owner",
  "quality_manager",
  "department_head",
  "staff",
  "consultant",
  "viewer",
] as const satisfies readonly PolicyRole[];

//                                 owner      quality     dept head   staff       consultant    viewer
const matrix: Record<Action, [Cell, Cell, Cell, Cell, Cell, Cell]> = {
  "facility.updateSettings": ["yes", "no", "no", "no", "no", "no"],
  "membership.manage": ["yes", "yes", "no", "no", "no", "no"],
  "subscription.view": ["yes", "no", "no", "no", "no", "no"],
  "assessment.score": ["yes", "yes", "ownDept", "no", "no", "no"],
  "tracer.run": ["yes", "yes", "ownDept", "assigned", "no", "no"],
  "tracer.manage": ["yes", "yes", "ownDept", "no", "no", "no"],
  "mockSurvey.run": ["no", "internal", "no", "no", "consultant", "no"],
  "document.upload": ["yes", "yes", "ownDept", "yes", "no", "no"],
  "document.approve": ["yes", "yes", "no", "no", "no", "no"],
  "capa.create": ["yes", "yes", "ownDept", "no", "no", "no"],
  "capa.recommend": ["no", "no", "no", "no", "yes", "no"],
  "capa.closeOwn": ["ownItem", "ownItem", "ownItem", "ownItem", "no", "no"],
  "dashboard.view": ["yes", "yes", "ownDept", "ownDept", "yes", "yes"],
  "audit.view": ["yes", "yes", "no", "no", "no", "no"],
};

const ME = "00000000-0000-7000-8000-000000000001";
const SOMEONE_ELSE = "00000000-0000-7000-8000-000000000002";
const FACILITY = "00000000-0000-7000-8000-0000000000f1";
const OTHER_FACILITY = "00000000-0000-7000-8000-0000000000f2";
const MY_DEPT = "00000000-0000-7000-8000-0000000000d1";
const OTHER_DEPT = "00000000-0000-7000-8000-0000000000d2";

function actorWith(role: PolicyRole): Actor {
  if (role === "consultant") {
    return { userId: ME, memberships: [], consultantFacilityIds: [FACILITY] };
  }
  const departmentId = role === "department_head" || role === "staff" ? MY_DEPT : null;
  return {
    userId: ME,
    memberships: [{ facilityId: FACILITY, departmentId, role }],
    consultantFacilityIds: [],
  };
}

// Each variant isolates one attribute a scope can depend on.
const variants: { name: string; resource: Resource; passes: Cell[] }[] = [
  { name: "facility-wide record", resource: { facilityId: FACILITY }, passes: ["yes"] },
  {
    name: "record in my department",
    resource: { facilityId: FACILITY, departmentId: MY_DEPT },
    passes: ["yes", "ownDept"],
  },
  {
    name: "record in another department",
    resource: { facilityId: FACILITY, departmentId: OTHER_DEPT },
    passes: ["yes"],
  },
  {
    name: "item I own",
    resource: { facilityId: FACILITY, ownerUserId: ME },
    passes: ["yes", "ownItem"],
  },
  {
    name: "item someone else owns",
    resource: { facilityId: FACILITY, ownerUserId: SOMEONE_ELSE },
    passes: ["yes"],
  },
  {
    name: "task assigned to me",
    resource: { facilityId: FACILITY, assigneeUserIds: [ME] },
    passes: ["yes", "assigned"],
  },
  {
    name: "task assigned to someone else",
    resource: { facilityId: FACILITY, assigneeUserIds: [SOMEONE_ELSE] },
    passes: ["yes"],
  },
  {
    name: "internal mock survey",
    resource: { facilityId: FACILITY, surveyKind: "internal" },
    passes: ["yes", "internal"],
  },
  {
    name: "consultant mock survey",
    resource: { facilityId: FACILITY, surveyKind: "consultant" },
    passes: ["yes", "consultant"],
  },
];

describe("can() mirrors the ARCHITECTURE §6 matrix", () => {
  it("covers every action", () => {
    expect(Object.keys(matrix).sort()).toEqual([...actions].sort());
  });

  const cases = roles.flatMap((role, column) =>
    actions.flatMap((action) =>
      variants.map((variant) => ({
        role,
        action,
        variant: variant.name,
        resource: variant.resource,
        expected: variant.passes.includes(matrix[action][column]!),
      })),
    ),
  );

  it.each(cases)(
    "$role · $action · $variant → $expected",
    ({ role, action, resource, expected }) => {
      expect(can(actorWith(role), action, resource)).toBe(expected);
    },
  );
});

describe("can() boundaries", () => {
  it.each(roles)("gives a %s nothing in a facility they do not belong to", (role) => {
    const actor = actorWith(role);
    for (const action of actions) {
      expect(can(actor, action, { facilityId: OTHER_FACILITY, ownerUserId: ME })).toBe(false);
    }
  });

  it("gives a user with no memberships (including the super-admin) nothing", () => {
    const actor: Actor = { userId: ME, memberships: [], consultantFacilityIds: [] };
    for (const action of actions) {
      expect(can(actor, action, { facilityId: FACILITY, ownerUserId: ME })).toBe(false);
    }
  });

  it("denies a department head when the membership has no department", () => {
    const actor: Actor = {
      userId: ME,
      memberships: [{ facilityId: FACILITY, departmentId: null, role: "department_head" }],
      consultantFacilityIds: [],
    };
    expect(can(actor, "assessment.score", { facilityId: FACILITY, departmentId: null })).toBe(
      false,
    );
  });

  it("combines several roles in the same facility", () => {
    const actor: Actor = {
      userId: ME,
      memberships: [
        { facilityId: FACILITY, departmentId: MY_DEPT, role: "staff" },
        { facilityId: FACILITY, departmentId: null, role: "viewer" },
      ],
      consultantFacilityIds: [],
    };
    expect(can(actor, "dashboard.view", { facilityId: FACILITY })).toBe(true);
    expect(can(actor, "document.upload", { facilityId: FACILITY })).toBe(true);
    expect(can(actor, "document.approve", { facilityId: FACILITY })).toBe(false);
  });

  it("limits a consultant to assigned facilities", () => {
    const actor = actorWith("consultant");
    const resource = { facilityId: OTHER_FACILITY, surveyKind: "consultant" } as const;
    expect(can(actor, "mockSurvey.run", resource)).toBe(false);
  });
});

describe("assignableRoles", () => {
  it.each([
    ["facility_owner", ["facility_owner", "quality_manager", "department_head", "staff", "viewer"]],
    ["quality_manager", ["department_head", "staff", "viewer"]],
    ["department_head", []],
    ["staff", []],
    ["viewer", []],
    ["consultant", []],
  ] as const)("a %s can assign %j", (role, expected) => {
    expect(assignableRoles(actorWith(role), FACILITY)).toEqual(expected);
  });

  it("never lets a quality manager create an owner or a peer", () => {
    const actor = actorWith("quality_manager");
    expect(canAssignRole(actor, FACILITY, "facility_owner")).toBe(false);
    expect(canAssignRole(actor, FACILITY, "quality_manager")).toBe(false);
    expect(canAssignRole(actor, FACILITY, "staff")).toBe(true);
  });

  it("gives nothing in another facility", () => {
    expect(assignableRoles(actorWith("facility_owner"), OTHER_FACILITY)).toEqual([]);
  });
});
