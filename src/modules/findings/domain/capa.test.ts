import { describe, expect, it } from "vitest";
import {
  capaEvidenceProblem,
  capaStatuses,
  capaTransitions,
  daysFrom,
  dueDateProblem,
  escalationLevel,
  escalationTargets,
  findingStatusFor,
  isOverdue,
  nextStatus,
  transitionProblem,
  verifiesFinding,
  type CapaStatus,
  type CapaTransition,
} from "./capa";

describe("nextStatus", () => {
  const allowed: Record<CapaTransition, Partial<Record<CapaStatus, CapaStatus>>> = {
    start: { open: "in_progress" },
    complete: { open: "done", in_progress: "done" },
    cancel: { open: "cancelled", in_progress: "cancelled" },
    reopen: { done: "in_progress" },
  };
  const cases = capaTransitions.flatMap((t) =>
    capaStatuses.map((s) => [s, t, allowed[t][s] ?? null] as const),
  );
  it.each(cases)("%s + %s → %s", (status, transition, expected) => {
    expect(nextStatus(status, transition)).toBe(expected);
  });
});

describe("transitionProblem", () => {
  const base = {
    status: "in_progress" as CapaStatus,
    transition: "complete" as CapaTransition,
    evidenceCount: 1,
    note: "Retrained the team",
    findingStatus: "in_progress" as const,
  };
  it.each([
    ["complete with evidence and a note", {}, null],
    ["complete without evidence", { evidenceCount: 0 }, "evidenceRequired"],
    ["complete without a note", { note: "  " }, "closureNoteRequired"],
    [
      "complete with neither (evidence first)",
      { evidenceCount: 0, note: null },
      "evidenceRequired",
    ],
    ["complete from open", { status: "open" }, null],
    ["complete when already done", { status: "done" }, "invalidTransition"],
    ["complete when cancelled", { status: "cancelled" }, "invalidTransition"],
    ["start from open", { status: "open", transition: "start", note: null }, null],
    ["start when in progress", { transition: "start" }, "invalidTransition"],
    ["cancel with a reason", { transition: "cancel" }, null],
    ["cancel without a reason", { transition: "cancel", note: "" }, "reasonRequired"],
    ["reopen with a reason", { status: "done", transition: "reopen" }, null],
    [
      "reopen without a reason",
      { status: "done", transition: "reopen", note: null },
      "reasonRequired",
    ],
    [
      "reopen once the finding is verified",
      { status: "done", transition: "reopen", findingStatus: "verified" },
      "findingVerified",
    ],
    ["reopen when not done", { transition: "reopen" }, "invalidTransition"],
  ] as const)("%s", (_name, change, expected) => {
    expect(transitionProblem({ ...base, ...change })).toBe(expected);
  });
});

describe("dueDateProblem", () => {
  it.each([
    ["2026-10-18", "dueInPast"],
    ["2026-10-19", null],
    ["2026-11-01", null],
  ] as const)("due %s on 2026-10-19 → %s", (due, expected) => {
    expect(dueDateProblem(due, "2026-10-19")).toBe(expected);
  });
});

describe("daysFrom", () => {
  it.each([
    ["2026-10-19", "2026-10-19", 0],
    ["2026-10-19", "2026-10-26", 7],
    ["2026-10-26", "2026-10-19", -7],
    ["2026-02-28", "2026-03-01", 1],
    ["2026-12-31", "2027-01-14", 14],
  ] as const)("%s → %s = %i", (from, to, expected) => {
    expect(daysFrom(from, to)).toBe(expected);
  });
});

describe("isOverdue and escalationLevel", () => {
  const due = "2026-10-01";
  it.each([
    ["before the due day", "2026-09-30", "open", false, 0],
    ["on the due day", "2026-10-01", "open", false, 0],
    ["1 day overdue", "2026-10-02", "open", true, 1],
    ["6 days overdue", "2026-10-07", "in_progress", true, 1],
    ["7 days overdue", "2026-10-08", "in_progress", true, 2],
    ["13 days overdue", "2026-10-14", "open", true, 2],
    ["14 days overdue", "2026-10-15", "open", true, 3],
    ["90 days overdue", "2026-12-30", "open", true, 3],
    ["done after the due day", "2026-10-20", "done", false, 0],
    ["cancelled after the due day", "2026-10-20", "cancelled", false, 0],
  ] as const)("%s", (_name, today, status, overdue, level) => {
    expect(isOverdue({ status, dueOn: due }, today)).toBe(overdue);
    expect(escalationLevel({ status, dueOn: due }, today)).toBe(level);
  });

  it.each([
    [0, []],
    [1, ["itemOwner"]],
    [2, ["itemOwner", "qualityManager"]],
    [3, ["itemOwner", "qualityManager", "facilityOwner"]],
  ] as const)("level %i tells %o", (level, targets) => {
    expect(escalationTargets(level)).toEqual(targets);
  });
});

describe("findingStatusFor", () => {
  const items = (...statuses: CapaStatus[]) => statuses.map((status) => ({ status }));
  it.each([
    ["no actions", "open", items(), "open"],
    ["only cancelled actions", "in_progress", items("cancelled"), "open"],
    ["an open action", "open", items("open"), "in_progress"],
    ["one done, one in progress", "in_progress", items("done", "in_progress"), "in_progress"],
    ["all done", "in_progress", items("done", "done"), "closed"],
    ["done and cancelled", "in_progress", items("done", "cancelled"), "closed"],
    ["reopened after closing", "closed", items("in_progress"), "in_progress"],
    ["verified stays verified", "verified", items("in_progress"), "verified"],
  ] as const)("%s", (_name, current, list, expected) => {
    expect(findingStatusFor(current, list)).toBe(expected);
  });
});

describe("verifiesFinding", () => {
  const closedAt = new Date("2026-10-10T08:00:00Z");
  const later = new Date("2026-10-12T08:00:00Z");
  const earlier = new Date("2026-10-09T08:00:00Z");
  it.each([
    ["full compliance after closing", { status: "closed", closedAt }, 1, later, true],
    ["full compliance before closing", { status: "closed", closedAt }, 1, earlier, false],
    ["partial compliance after closing", { status: "closed", closedAt }, 0.5, later, false],
    ["finding still in progress", { status: "in_progress", closedAt: null }, 1, later, false],
    ["finding already verified", { status: "verified", closedAt }, 1, later, false],
  ] as const)("%s", (_name, finding, normalized, scoredAt, expected) => {
    expect(verifiesFinding(finding, { normalized, scoredAt })).toBe(expected);
  });
});

describe("capaEvidenceProblem", () => {
  const id = "0190f3c4-0000-7000-8000-000000000001";
  it.each([
    [{ kind: "document", documentVersionId: id, url: null }, null],
    [{ kind: "document", documentVersionId: null, url: "https://x.test" }, "documentRequired"],
    [{ kind: "link", documentVersionId: null, url: "https://intranet.test/minutes" }, null],
    [{ kind: "link", documentVersionId: null, url: "http://intranet.test" }, null],
    [{ kind: "link", documentVersionId: null, url: "javascript:alert(1)" }, "invalidUrl"],
    [{ kind: "link", documentVersionId: null, url: "not a url" }, "invalidUrl"],
    [{ kind: "link", documentVersionId: null, url: null }, "invalidUrl"],
  ] as const)("%o → %s", (input, expected) => {
    expect(capaEvidenceProblem(input)).toBe(expected);
  });
});
