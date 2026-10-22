# Final acceptance (brief §11)

Every acceptance item in the brief is shown by an automated Playwright test. The suite runs on
every pull request (desktop and Pixel 7 viewports, Arabic by default) after `pnpm db:seed`,
which installs the fictional DEMO-AMB framework and the demo tenant.

Two kinds of test share the work:

- **The demo tenant** (`tests/e2e/acceptance.spec.ts`) signs in as the seeded people of
  «مستوصف النور التجريبي» (Al-Noor Demo Polyclinic) and checks the six months of history the
  seed wrote: the trend, the ESR status, the action plan, the documents and the consultant's
  report.
- **The journeys** of earlier milestones start from an empty organization and do each task
  through the screens, so they prove the task can be done, not only that its result exists.

| §11 item                                                                                             | Demonstrated by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A demo tenant: one fictional polyclinic, five departments, placeholder standards, six months of data | `prisma/seed/demo-tenant.ts`. `acceptance.spec.ts` › "the quality manager reads six months of readiness on the dashboard" (about 175 nightly points that climb, dip and recover; the five departments; the eight DEMO chapters) and "the history is on record" (four self-assessments, four tracer templates with more than 40 runs, more than 80 verified findings, documents with a revision and one awaiting approval). "every role signs in to the polyclinic" covers owner, department heads, staff and viewer; quality manager, consultant and platform admin sign in in the other tests. |
| Set up the facility                                                                                  | `onboarding.spec.ts` › "an owner completes the onboarding wizard in Arabic" and "the wizard reads in English". Facility settings belong to the owner (ARCHITECTURE §6): a quality manager runs everything else.                                                                                                                                                                                                                                                                                                                                                                                 |
| Run a self-assessment                                                                                | `assessments.spec.ts` › "a quality manager completes a pharmacy assessment" and "the assessment screens read in English".                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Upload and version documents                                                                         | `documents.spec.ts` › "a policy goes from upload to approval, is cited in a score and revised", "a file that looks like patient data is stopped", "the documents screen reads in English". On the demo tenant: "the history is on record".                                                                                                                                                                                                                                                                                                                                                      |
| Assign and close action items                                                                        | `findings.spec.ts` › "a finding is planned, closed with evidence and verified by a later assessment" and "the findings screen reads in English". On the demo tenant: the overdue count and the verified findings in the first two acceptance tests.                                                                                                                                                                                                                                                                                                                                             |
| Run a tracer from a phone                                                                            | `acceptance.spec.ts` › "the quality manager walks a pharmacy tracer on a phone" (mobile project, demo tenant). `tracers.spec.ts` › "a pharmacy tracer is set up, walked one element at a time and submitted" (both viewports) and "the tracers screen reads in English".                                                                                                                                                                                                                                                                                                                        |
| See the dashboard with trend and ESR status, in Arabic and English                                   | `acceptance.spec.ts` › "the quality manager reads six months of readiness on the dashboard" (both languages, with axe). `dashboards.spec.ts` › "the readiness dashboard shows scores, ESR, the trend and the survey countdown".                                                                                                                                                                                                                                                                                                                                                                 |
| A consultant runs a mock survey on a Hybrid facility and exports the findings report as PDF          | `mock-surveys.spec.ts` › "a consultant runs a mock survey and exports both PDFs" (the platform admin makes the tenant Hybrid and assigns the consultant, who scores, locks and issues the Arabic and English PDFs). On the demo tenant: `acceptance.spec.ts` › "the consultant opens the mock survey and downloads its findings report". `consultants.spec.ts` checks the consultant sees only the assigned facility.                                                                                                                                                                           |
| All tests pass; the README explains how to run locally                                               | CI on every pull request (`pnpm check` and `pnpm test:e2e`). README › "Run locally" and "Try the demo polyclinic".                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## How the demo history is made

The seed does not write rows into the history tables. Submitted scores, approvals, closed
actions and snapshots are immutable once written, so the seed walks through the six months
day by day and calls the same services as the screens, passing each step's time as `now`.
All the rules apply as they would for a real facility: evidence for "met", ESR elements met or
not met only, CAPA closure with evidence, rule 7 verification by a later check, the 90-day score
validity and the nightly snapshot.

The story: a first whole-facility self-assessment (about 64%, four ESR elements not met),
weekly tracers in nursing, pharmacy and across the facility, a monthly infection-control
tracer, actions planned for every new finding and closed when the gap is fixed, and a second
self-assessment at three months (about 99%, ready). Nursing then slips when staff turn over,
including one ESR element, and a department assessment confirms it (about 88%, not ready);
it recovers over the following weeks. The consultant's mock survey runs at five months. A
third self-assessment a week before today finds an infection-control ESR element lapsed, so
the facility ends "not ready" with that action under way, and one administrative action has
been overdue since the first month.

Columns the database stamps with `now()` (a finding's creation, an upload, a notification)
are moved afterwards to the simulated time of the step that wrote them. The audit log is left
as written: its times are part of the hash chain, and it truthfully records that the seed
wrote the history on the day it ran.
