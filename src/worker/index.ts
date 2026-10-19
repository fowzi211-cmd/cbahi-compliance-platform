import "dotenv/config";
import { PgBoss } from "pg-boss";
import { disconnectDb } from "@/lib/db";
import { TIME_ZONE } from "@/lib/dates";
import { jobNames, runJob, type JobName } from "./run";

// `pnpm worker`: the background process (ARCHITECTURE §2, deployment shape). pg-boss keeps
// its queue in Postgres (schema `pgboss`, owned by the system role), so there is no Redis.
// Schedules are in Riyadh time: reminders at 06:00, the digest at 07:00 so it carries the
// morning's reminders, and the email sweep every minute.

const schedules: Record<JobName, string> = {
  reminders: "0 6 * * *",
  digest: "0 7 * * *",
  deliver: "* * * * *",
};

async function main() {
  const connectionString = process.env.DATABASE_SYSTEM_URL;
  if (!connectionString) throw new Error("DATABASE_SYSTEM_URL is not set");
  // The schema comes from a migration; this role cannot create schemas.
  const boss = new PgBoss({ connectionString, schema: "pgboss", createSchema: false });
  boss.on("error", (error) => console.error("pg-boss", error));
  await boss.start();

  for (const name of jobNames) {
    await boss.createQueue(name);
    await boss.schedule(name, schedules[name], null, { tz: TIME_ZONE });
    await boss.work(name, async () => {
      // The job's own data is ignored: every run works as of the moment it starts.
      await runJob(name, new Date());
    });
  }
  console.log(`worker started: ${jobNames.join(", ")}`);

  const stop = async () => {
    await boss.stop({ graceful: true });
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
