# Framework import format (`mustamir.framework/v1`)

This is how an accreditation framework edition is loaded into the standards library. The format
is our own and neutral: it describes chapters, standards, measurable elements and a scoring
scale. **Framework text never lives in this repository.** Licensed text is uploaded at runtime
by the platform admin, and only fictional `DEMO-*` content is committed (see
`prisma/seed/demo-amb.json`, which is also a complete example of the JSON layout).

## The flow

1. The platform admin uploads a file at `/{locale}/platform/standards` (CSV, XLSX or JSON, up to 5 MB).
2. The file is validated. **Every** problem is reported with its sheet, row and column; nothing is
   stored when there is an error. Warnings (a missing translation, an unknown column, an empty
   chapter) do not block.
3. A valid file is kept as an _import_ and shown as a preview: counts, warnings, and a diff
   against the live edition of the same framework code (or the latest edition if none is live).
   ESR changes are listed separately.
4. **Create draft edition** writes the edition exactly as previewed, with status `draft`.
   Facilities cannot see drafts (enforced by Row-Level Security).
5. The admin records a **licence note** (who licensed the text and on what terms) and
   **activates** the edition. Activation retires the edition that was live before, in the same
   transaction. Only one edition per code can be live. Retired editions stay readable, because
   assessments made against them keep pointing at their text.

Every step is written to the platform audit log.

## Layouts

### XLSX: one workbook, five sheets

Sheet names are matched case-insensitively: `framework`, `scale` (optional), `chapters`,
`standards`, `elements`. Row 1 of each sheet is the header. Other sheets (notes, instructions)
are ignored. Error rows are spreadsheet rows (the header is row 1).

### JSON

```json
{
  "format": "mustamir.framework/v1",
  "framework": { "code": "DEMO-AMB", "edition": "2026.1", "name_ar": "…", "name_en": "…", "program": "ambulatory" },
  "scale": [ … ],
  "chapters": [ { "code": "DEMO-GOV", "title_ar": "…", "title_en": "…" } ],
  "standards": [ { "code": "DEMO-GOV.1", "chapter_code": "DEMO-GOV", "title_ar": "…", "title_en": "…" } ],
  "elements": [ { "code": "DEMO-GOV.1.1", "standard_code": "DEMO-GOV.1", "title_ar": "…", "is_esr": true } ]
}
```

Keys are the column names below. Lists may be JSON arrays or `|`-separated text. Error rows are
1-based positions in each array. `format` is optional; if present it must be
`mustamir.framework/v1`.

### CSV: one file of elements

A CSV holds one row per element, with its chapter and standard repeated on each row. The
framework details (`code`, `edition`, `name_ar`, `name_en`, `program`) are typed into the upload
form. The scale and roll-up use the defaults.

| Column                                   | Notes                                                  |
| ---------------------------------------- | ------------------------------------------------------ |
| `chapter_code` (required)                | The chapter the element belongs to.                    |
| `chapter_title_ar`, `chapter_title_en`   | Only needed on the first row of each chapter.          |
| `standard_code` (required)               | The standard the element belongs to.                   |
| `standard_title_ar`, `standard_title_en` | Only needed on the first row of each standard.         |
| `standard_weight`                        | Optional, default 1.                                   |
| element columns                          | As in the `elements` sheet below (`code` is required). |

If a chapter or standard appears with different titles (or a standard in two chapters) on
different rows, that is an error, since one of them is a typo. Save from Excel as
**CSV UTF-8**; other encodings are refused. `,`, `;` and tab delimiters are detected.

## Columns

Text can be in Arabic, English or both. At least one language is required for every title; a
missing one is a warning, and readers then see the other language with a "translation missing"
badge.

### `framework` (exactly one row)

| Column               | Required    | Rules                                                                                     |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `code`               | yes         | Capital Latin letters, digits, `.`, `_`, `-`; 2–32 characters. Same code across editions. |
| `edition`            | yes         | Up to 32 characters, e.g. `2026.1`. A code + edition pair can only be imported once.      |
| `name_ar`, `name_en` | one of them |                                                                                           |
| `program`            | yes         | `ambulatory`, `primary`, `lab`, `blood_bank`, `dental`, `home_health`, `hospital`.        |
| `rollup_config`      | no          | JSON, see below. Defaults to weighted averages and ESR = MET/NM.                          |

### `scale` (optional; default MET / PM / NM / NA)

| Column                  | Required    | Default | Meaning                                                       |
| ----------------------- | ----------- | ------- | ------------------------------------------------------------- |
| `code`                  | yes         |         | Capital letters, up to 8, e.g. `MET`.                         |
| `label_ar`, `label_en`  | one of them |         |                                                               |
| `value`                 | yes         |         | 0 to 1.                                                       |
| `counts_in_denominator` | no          | yes     | `no` for Not Applicable.                                      |
| `requires_evidence`     | no          | no      | The score cannot be saved without evidence (anti-decoration). |
| `generates_finding`     | no          | no      | Scoring this level creates a finding.                         |

The default scale is MET (1, evidence required), PM (0.5, evidence required, finding), NM (0,
finding) and NA (not counted). At least two levels are needed. The levels named in
`rollup_config.esr.allowed_levels` must exist, and one of them must be below 1 so an ESR element
can fail.

### `chapters`

`code` (required, unique), `title_ar`, `title_en`. Order in the file is display order.

### `standards`

`code` (required, unique), `chapter_code` (required, must exist), `title_ar`, `title_en`,
`weight` (number above 0, default 1).

### `elements`

| Column                             | Required    | Rules                                                                                                                          |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `code`                             | yes         | Unique in the edition. Letters (any script), digits, `.`, `_`, `-`, `/`; up to 64.                                             |
| `standard_code`                    | yes         | Must exist in `standards`.                                                                                                     |
| `title_ar`, `title_en`             | one of them | Up to 500 characters.                                                                                                          |
| `description_ar`, `description_en` | no          | Up to 5000 characters.                                                                                                         |
| `is_esr`                           | no          | Yes/no, default no. Essential safety requirement: only the ESR levels apply, and any ESR not met makes the facility not ready. |
| `weight`                           | no          | Number above 0, default 1.                                                                                                     |
| `evidence_types`                   | no          | List of `document`, `observation`, `interview`, `record_review`, `kpi`.                                                        |
| `facility_types`                   | no          | List from the facility-type catalogue. Empty means every facility type.                                                        |
| `department_types`                 | no          | List from the department-type catalogue. Empty means facility-wide.                                                            |

Yes/no cells accept `yes/no`, `true/false`, `1/0`, `y/n`, `نعم/لا`. Numbers accept Arabic-Indic
digits and the Arabic decimal separator. Lists are separated by `|`, `,`, `;` or `،`.

**Facility types:** `hospital`, `polyclinic`, `primary_care`, `dental`, `laboratory`,
`home_care`, `other`.

**Department types:** `administration`, `quality`, `reception`, `outpatient`, `emergency`,
`nursing`, `pharmacy`, `laboratory`, `radiology`, `dental`, `infection_control`,
`sterilization`, `facility_management`, `human_resources`, `health_information`.

Both catalogues are tables (`facility_type`, `department_type`) and grow through migrations.

## `rollup_config`

```json
{
  "standard": { "method": "weighted_average", "met_threshold": 1.0, "pm_threshold": 0.5 },
  "chapter": { "method": "weighted_average" },
  "facility": { "method": "weighted_average" },
  "esr": { "allowed_levels": ["MET", "NM"], "any_not_met_blocks_readiness": true }
}
```

Every part is optional. Methods: `weighted_average` (Σ weight·score / Σ weight),
`all_must_meet` (fully met only when every child is), and `threshold` (the weighted share of fully
met children: at or above `met_threshold` counts as met, at or above `pm_threshold` as partially
met). How the scoring engine applies them is in ARCHITECTURE §4, "As built in M6".

## Limits

5 MB per file, 5000 elements per edition.
