// The result a server action hands back to its form. `error` is a translation key under the
// form's namespace; the action never returns raw exception text.
export type FormState =
  { status: "idle" } | { status: "error"; error: string } | { status: "done" };

export const idleState: FormState = { status: "idle" };
