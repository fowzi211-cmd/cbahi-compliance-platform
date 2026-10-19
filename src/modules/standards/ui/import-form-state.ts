import type { ImportIssue } from "../domain/issues";

// What the upload action hands back to its form. A valid file redirects to its preview, so
// only problems come back here.
export type ImportFormState =
  | { status: "idle" }
  // The framework fields are sent back so the form can keep what was typed.
  | { status: "invalid"; issues: ImportIssue[]; framework?: Record<string, string> }
  | { status: "error"; error: string };

export const idleImportState: ImportFormState = { status: "idle" };
