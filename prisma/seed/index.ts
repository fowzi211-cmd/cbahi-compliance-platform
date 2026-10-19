import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { disconnectDb } from "@/lib/db";
import { seedEdition } from "@/modules/standards/service";

// `pnpm db:seed`: loads fictional demo content only (CLAUDE.md: never real standard text).
// The demo tenant arrives with M17.

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
}

main().finally(disconnectDb);
