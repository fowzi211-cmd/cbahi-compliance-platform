import "dotenv/config";
import { disconnectDb } from "@/lib/db";
import { verifyAllChains } from "@/modules/audit/service";

// Usage: pnpm audit:verify
// Recomputes every audit chain (each organization's and the platform's own) and exits 1 if
// any link is broken, naming the first broken position. Safe to run at any time: it only
// reads. Run it from cron or after a restore to prove the log was not altered.

async function main() {
  const chains = await verifyAllChains();
  let broken = 0;
  for (const { tenantId, result } of chains) {
    const name = tenantId ?? "platform";
    if (result.ok) {
      console.log(`ok      ${name}  ${result.checked} events`);
    } else {
      broken += 1;
      console.error(`BROKEN  ${name}  first broken event #${result.firstBrokenSeq}`);
    }
  }
  const events = chains.reduce((sum, c) => sum + c.result.checked, 0);
  console.log(`${chains.length} chains, ${events} events, ${broken} broken.`);
  if (broken > 0) process.exitCode = 1;
}

main().finally(disconnectDb);
