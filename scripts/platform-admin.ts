import "dotenv/config";
import { disconnectDb } from "@/lib/db";
import { setPlatformAdmin } from "@/modules/identity/service";

// Usage: pnpm platform:admin <email> [--revoke]
// Gives an existing account the platform-admin flag (standards library, tiers). The account
// must still enrol in two-factor authentication before it can open the platform pages.

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email || (flag !== undefined && flag !== "--revoke")) {
    console.error("Usage: pnpm platform:admin <email> [--revoke]");
    process.exitCode = 2;
    return;
  }
  const grant = flag !== "--revoke";
  if (!(await setPlatformAdmin(email, grant))) {
    console.error(`No account with the email ${email}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`${email} ${grant ? "is now" : "is no longer"} a platform admin.`);
}

main().finally(disconnectDb);
