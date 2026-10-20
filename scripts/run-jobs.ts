import "dotenv/config";
import { disconnectDb } from "@/lib/db";
import { jobNames, runJob, type JobName } from "@/worker/run";

// Usage: pnpm jobs:run <reminders|deliver|digest|snapshots|signals>... [--now 2026-11-01T06:00:00Z]
// Runs jobs once, in the order given, without the queue. For operations (catching up after
// downtime) and for tests that need a fake clock.

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--now");
  const now = at >= 0 ? new Date(args[at + 1] ?? "") : new Date();
  const names = args.filter((arg, i) => !arg.startsWith("--") && i !== at + 1);
  if (
    Number.isNaN(now.getTime()) ||
    names.length === 0 ||
    !names.every((n) => (jobNames as readonly string[]).includes(n))
  ) {
    console.error(`Usage: pnpm jobs:run <${jobNames.join("|")}>... [--now <ISO time>]`);
    process.exitCode = 2;
    return;
  }
  for (const name of names as JobName[]) {
    const results = await runJob(name, now);
    console.log(name, JSON.stringify(results));
  }
}

main().finally(disconnectDb);
