import "dotenv/config";

// The seed writes months of history in a few minutes; the per-person limits are for people.
process.env.RATE_LIMITS = "off";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { disconnectDb } from "@/lib/db";
import { seedEdition } from "@/modules/standards/service";
import { demoCredentialsFile, seedDemoTenant } from "./demo-tenant";

// `pnpm db:seed`: loads fictional demo content only (CLAUDE.md: never real standard text).
// Then the M17 demo tenant, «مستوصف النور التجريبي», with six months of history.

const LICENSE_NOTE =
  "Fictional demo content written for Mustamir. It is not CBAHI, JCI or MOH text and implies no endorsement.";

async function main() {
  const file = path.join(import.meta.dirname, "demo-amb.json");
  const result = await seedEdition({
    fileName: "demo-amb.json",
    bytes: new Uint8Array(await readFile(file)),
    licenseNote: LICENSE_NOTE,
  });
  if (result.status === "invalid") {
    console.error("demo-amb.json is invalid:", JSON.stringify(result.issues, null, 2));
    process.exitCode = 1;
  } else if (result.status === "exists") {
    console.log("DEMO-AMB is already installed.");
  } else {
    console.log(`DEMO-AMB installed and active (${result.elements} elements).`);
  }
  if (result.status === "invalid") return;

  const demo = await seedDemoTenant();
  if (demo === "created") {
    console.log(`Demo tenant created. Sign-in details: ${demoCredentialsFile}`);
  } else if (demo === "exists") {
    console.log("The demo tenant already exists.");
  } else {
    console.log("Skipped the demo tenant (NODE_ENV=production).");
  }
}

main().finally(disconnectDb);
