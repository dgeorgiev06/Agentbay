import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HandedIn } from "../../../bay/adapter.ts";
import { readPayload, type PolicyReading } from "../guard-input.ts";

const sightingsFile = join(".agentbay", "hook-sightings.db");

const submitTool = "mcp__agentbay__submit";

const busyMilliseconds = 3000;

export type Sighting = {
  readonly token: string;
  readonly agent: string;
  readonly mode: string;
  readonly skill: string;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sightingOf(policy: PolicyReading, payload: unknown): Sighting | undefined {
  const reading = readPayload(payload);
  if (reading.kind !== "call" || policy.kind !== "read") {
    return undefined;
  }
  const { call } = reading;
  if (call.tool !== submitTool || call.agentId === undefined || call.agentType === undefined) {
    return undefined;
  }
  const rules = policy.policy.agents.get(call.agentType);
  const token = call.input["token"];
  if (rules === undefined || typeof token !== "string" || token === "") {
    return undefined;
  }
  return { token, agent: call.agentType, mode: rules.mode, skill: rules.skill };
}

export function recordSighting(project: string, sighting: Sighting, now: Date): void {
  const file = join(project, sightingsFile);
  closeSync(openSync(file, "a", 0o600));
  const database = new DatabaseSync(file, { timeout: busyMilliseconds });
  try {
    database.exec(
      `create table if not exists sightings (
        token_hash text not null,
        agent text not null,
        mode text not null,
        skill text not null,
        seen_at text not null
      )`,
    );
    database
      .prepare("insert into sightings (token_hash, agent, mode, skill, seen_at) values (?, ?, ?, ?, ?)")
      .run(tokenHash(sighting.token), sighting.agent, sighting.mode, sighting.skill, now.toISOString());
  } finally {
    database.close();
  }
}

function usedSighting(file: string, handedIn: HandedIn): boolean {
  const database = new DatabaseSync(file, { timeout: busyMilliseconds });
  try {
    const used = database
      .prepare(
        `delete from sightings where rowid = (
          select rowid from sightings where token_hash = ? and mode = ? and skill = ? order by rowid limit 1
        ) returning rowid`,
      )
      .get(tokenHash(handedIn.token), handedIn.mode, handedIn.skill);
    return used !== undefined;
  } finally {
    database.close();
  }
}

export function hookSaw(handedIn: HandedIn): Promise<boolean> {
  const file = join(handedIn.project, sightingsFile);
  if (!existsSync(file)) {
    return Promise.resolve(false);
  }
  try {
    return Promise.resolve(usedSighting(file, handedIn));
  } catch {
    return Promise.resolve(false);
  }
}
