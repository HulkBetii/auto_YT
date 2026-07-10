import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const jobId = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isFinite(jobId)) throw new Error("Usage: tsx scripts/e2e_reset_job.mts <job_id>");

const { db } = await import("../lib/db/index.js");
const { jobs } = await import("../lib/db/schema/jobs.js");

await db
  .update(jobs)
  .set({
    status: "pending",
    result: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    consumedAt: null,
  })
  .where(eq(jobs.id, jobId));

console.log(`job #${jobId} reset to pending`);
process.exit(0);
