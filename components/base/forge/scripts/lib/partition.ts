import { fail, type DatabasePartition, type ScriptContext } from "../../../../../bay/sdk.ts";

export async function migratedPartition(context: ScriptContext, name: string): Promise<DatabasePartition> {
  const partition = context.db.partition(name);
  const migrated = await partition.migrate();
  return migrated.ok ? partition : fail(`forge could not prepare the partition ${name}: ${migrated.message}`);
}
