import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { kit } from "./project-fixture.ts";

export type ModeFiles = Readonly<Record<string, string>>;

function kitFiles(): readonly string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: kit,
    encoding: "utf8",
  });
  return listed
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(kit, file)) && !lstatSync(join(kit, file)).isSymbolicLink());
}

export async function copyOfTheKit(label: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `agentbay-${label}-`)));
  for (const file of kitFiles()) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(kit, file), join(root, file));
  }
  await symlink(join(kit, "node_modules"), join(root, "node_modules"));
  return root;
}

export async function addMode(copy: string, folder: string, files: ModeFiles): Promise<void> {
  assert.equal(existsSync(join(copy, folder)), false, `the kit already holds ${folder}`);
  for (const [path, text] of Object.entries(files)) {
    const file = join(copy, folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

export function failedTests(output: string): readonly string[] {
  return [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
}
