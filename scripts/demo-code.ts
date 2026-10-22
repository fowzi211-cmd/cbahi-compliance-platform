import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { demoCredentialsFile, type DemoCredentials } from "../prisma/seed/demo-tenant";

// Usage: pnpm demo:code [person]
// Prints the demo tenant's people and passwords (from .demo-credentials.json, written by
// `pnpm db:seed`), with the current authenticator code for those who need one. Saves
// scanning a QR code just to look around the demo locally.

async function main() {
  const wanted = process.argv[2];
  const demo = JSON.parse(await readFile(demoCredentialsFile, "utf8")) as DemoCredentials;
  const rows = Object.entries(demo.people).filter(([key]) => !wanted || key === wanted);
  if (rows.length === 0) {
    console.error(`Unknown person. Choose one of: ${Object.keys(demo.people).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  console.log(`Password for everyone: ${demo.password}`);
  for (const [key, person] of rows) {
    const code = person.totpSecret
      ? new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(person.totpSecret) }).generate()
      : "(no second factor)";
    console.log(`${key.padEnd(14)} ${person.email.padEnd(40)} ${code}`);
  }
}

main().catch((error: unknown) => {
  console.error(
    (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "No .demo-credentials.json: run `pnpm db:seed` first."
      : error,
  );
  process.exitCode = 1;
});
