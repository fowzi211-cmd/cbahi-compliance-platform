import { describe, expect, it } from "vitest";
import { createTenantInput, membershipInput } from "./schemas";

const ids = {
  user: "0190f000-0000-7000-8000-000000000001",
  facility: "0190f000-0000-7000-8000-000000000002",
  department: "0190f000-0000-7000-8000-000000000003",
};

describe("membershipInput", () => {
  it("requires a department for department heads", () => {
    const result = membershipInput.safeParse({
      userId: ids.user,
      facilityId: ids.facility,
      role: "department_head",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a facility-wide quality manager", () => {
    expect(
      membershipInput.safeParse({
        userId: ids.user,
        facilityId: ids.facility,
        role: "quality_manager",
      }).success,
    ).toBe(true);
  });
});

describe("createTenantInput", () => {
  it("normalises the owner email and defaults to the Platform tier", () => {
    const parsed = createTenantInput.parse({
      name: "Demo Group",
      owner: { email: "Owner@Example.SA", name: "Owner" },
      facility: { nameAr: "عيادة", nameEn: "Clinic", type: "polyclinic" },
    });
    expect(parsed.owner.email).toBe("owner@example.sa");
    expect(parsed.tier).toBe("platform");
  });
});
