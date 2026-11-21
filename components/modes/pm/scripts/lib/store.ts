import { fail, readYaml, type DatabasePartition, type ScriptContext } from "../../../../../bay/sdk.ts";
import { interviewOf, type Interview } from "./interview.ts";

const partitionName = "interviews";

async function openedPartition(context: ScriptContext): Promise<DatabasePartition> {
  const partition = context.db.partition(partitionName);
  const migrated = await partition.migrate();
  return migrated.ok ? partition : fail(`The PM mode could not prepare its records: ${migrated.message}`);
}

export async function readInterview(context: ScriptContext, job: string): Promise<Interview | undefined> {
  const partition = await openedPartition(context);
  const rows = await partition.query("select state from interviews where job = :job", { job });
  if (!rows.ok) {
    return fail(rows.message);
  }
  const state = rows.value[0]?.["state"];
  if (typeof state !== "string") {
    return undefined;
  }
  const read = readYaml(state);
  return read.ok ? interviewOf(read.value) : fail(`The PM mode's record of the interview of ${job} cannot be read.`);
}

export async function writeInterview(context: ScriptContext, interview: Interview): Promise<void> {
  const partition = await openedPartition(context);
  const written = await partition.execute(
    "insert into interviews (job, state) values (:job, :state) on conflict (job) do update set state = :state",
    { job: interview.job, state: JSON.stringify(interview) },
  );
  if (!written.ok) {
    fail(written.message);
  }
}
