import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { numberOf } from "./json-values.ts";
import { migratedPartition } from "./partition.ts";

const partitionName = "names-given";

export type Given = {
  readonly name: string;
  readonly earlier: readonly string[];
};

export function nameFor(wanted: string, times: number): string {
  return times <= 1 ? wanted : `${wanted}-again-${String(times)}`;
}

export function givenOf(wanted: string, times: number): Given {
  const earlier = Array.from({ length: Math.max(0, times - 1) }, (_, at) => nameFor(wanted, at + 1));
  return { name: nameFor(wanted, times), earlier };
}

export function leftBy(earlier: readonly string[], folders: readonly string[]): readonly string[] {
  return folders.filter((folder) => earlier.some((name) => folder === name || folder.startsWith(`${name}-`)));
}

export async function givenName(context: ScriptContext, wanted: string): Promise<Given> {
  const partition = await migratedPartition(context, partitionName);
  const counted = await partition.execute(
    "insert into names_given (wanted, times) values (?, 1) on conflict (wanted) do update set times = times + 1",
    [wanted],
  );
  if (!counted.ok) {
    return fail(`forge could not count the name ${wanted} in ${partitionName}: ${counted.message}`);
  }
  const rows = await partition.query("select times from names_given where wanted = ?", [wanted]);
  if (!rows.ok) {
    return fail(`forge could not read the name ${wanted} in ${partitionName}: ${rows.message}`);
  }
  return givenOf(wanted, numberOf(rows.value[0]?.times));
}
