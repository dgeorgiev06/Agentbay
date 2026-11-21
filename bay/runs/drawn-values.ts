import { randomBytes } from "node:crypto";
import type { Json, RandomDrawer } from "../contracts.ts";
import { storedText, unpackedText } from "./packed-output.ts";

const mostDrawnPerStep = 64;

type NextDraw =
  | { readonly kind: "replayed"; readonly value: string }
  | { readonly kind: "fresh" }
  | { readonly kind: "refused"; readonly reason: string };

type Asked = {
  readonly stepKey: string;
  readonly index: number;
  readonly bytes: number;
};

function otherSize(asked: Asked, recorded: string): string {
  return (
    `Random value ${String(asked.index + 1)} of step ${asked.stepKey} was drawn as ` +
    `${String(recorded.length / 2)} bytes when the step first ran, and ${String(asked.bytes)} are asked now; ` +
    "a step that runs again asks for its values in the same order and sizes."
  );
}

function nextDraw(recorded: readonly string[], asked: Asked): NextDraw {
  const earlier = recorded[asked.index];
  if (earlier !== undefined) {
    return earlier.length === asked.bytes * 2
      ? { kind: "replayed", value: earlier }
      : { kind: "refused", reason: otherSize(asked, earlier) };
  }
  if (asked.index >= mostDrawnPerStep) {
    const most = String(mostDrawnPerStep);
    return {
      kind: "refused",
      reason: `Step ${asked.stepKey} has drawn ${most} random values, the most one step records.`,
    };
  }
  return { kind: "fresh" };
}

export function packedDrawn(drawn: readonly string[]): string {
  return storedText(JSON.stringify(drawn), "kept-packed");
}

function parsedList(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function unpackedDrawn(packed: Json | undefined): readonly string[] | undefined {
  if (packed === undefined) {
    return [];
  }
  const list = typeof packed === "string" ? parsedList(unpackedText(packed, "kept-packed")) : undefined;
  if (!Array.isArray(list) || !list.every((value) => typeof value === "string")) {
    return undefined;
  }
  return list.filter((value) => typeof value === "string");
}

type DrawnRecorder = (drawn: readonly string[]) => Promise<void>;

export function drawerFor(stepKey: string, recorded: readonly string[], record: DrawnRecorder): RandomDrawer {
  const drawn = [...recorded];
  let asks = 0;
  let written = Promise.resolve();
  return async (bytes) => {
    const index = asks;
    asks += 1;
    const next = nextDraw(drawn, { stepKey, index, bytes });
    switch (next.kind) {
      case "replayed":
        return { status: "done", value: next.value };
      case "refused":
        return { status: "failed", reason: next.reason };
      case "fresh": {
        const value = randomBytes(bytes).toString("hex");
        drawn.push(value);
        const snapshot = [...drawn];
        written = written.then(() => record(snapshot));
        await written;
        return { status: "done", value };
      }
    }
  };
}
