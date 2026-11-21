import { joined } from "./card-lines.ts";
import { committedFiles, modulesReached, type DesignSummary } from "./design-summary.ts";
import type { Plan, PlannedSlice } from "./plan.ts";

export type CutProblem =
  | { readonly kind: "no interface"; readonly level: "error"; readonly slice: string; readonly sentence: string }
  | {
      readonly kind: "interface not in the design";
      readonly level: "error";
      readonly slice: string;
      readonly file: string;
      readonly sentence: string;
    }
  | {
      readonly kind: "crosses modules";
      readonly level: "error";
      readonly slice: string;
      readonly modules: readonly string[];
      readonly sentence: string;
    }
  | { readonly kind: "not vertical"; readonly level: "error"; readonly slice: string; readonly sentence: string }
  | {
      readonly kind: "no request file";
      readonly level: "error";
      readonly slice: string;
      readonly conditions: readonly string[];
      readonly sentence: string;
    };

type Rule = (slice: PlannedSlice, design: DesignSummary) => readonly CutProblem[];

const namesNoInterface: Rule = (slice, design) => {
  if ((slice.interface ?? []).length > 0) {
    return [];
  }
  const sentence =
    `${slice.name} names no interface file. Name in interface the files of ${design.file} it builds ` +
    "against, so that its tests and its code meet there.";
  return [{ kind: "no interface", level: "error", slice: slice.name, sentence }];
};

const interfaceNotCommitted: Rule = (slice, design) => {
  const committed = committedFiles(design);
  return (slice.interface ?? [])
    .filter((file) => !committed.includes(file))
    .map((file) => {
      const sentence =
        `${slice.name} names the interface file ${file}, which the design ${design.file} did not commit. ` +
        "Name only the design file and the schema files it committed.";
      return { kind: "interface not in the design", level: "error", slice: slice.name, file, sentence };
    });
};

const crossesModules: Rule = (slice, design) => {
  const modules = modulesReached(slice, design);
  if (modules.length < 2 || slice.crossesModulesBecause !== undefined) {
    return [];
  }
  const sentence =
    `${slice.name} reaches the modules ${joined(modules)} of the design. ` +
    "Keep the slice to one module, or say in crossesModulesBecause why it must reach them all.";
  return [{ kind: "crosses modules", level: "error", slice: slice.name, modules, sentence }];
};

const notVertical: Rule = (slice) => {
  if ((slice.meets ?? []).length > 0 || slice.kind !== "mode") {
    return [];
  }
  const sentence =
    `${slice.name} meets no condition and is of kind mode, so nobody could see it working on its own. ` +
    "Name in meets the conditions it makes true, or make it a slice of kind interface or capability.";
  return [{ kind: "not vertical", level: "error", slice: slice.name, sentence }];
};

function servedWithoutRequest(slice: PlannedSlice, design: DesignSummary, condition: string): readonly string[] {
  const named = slice.interface ?? [];
  const servers = design.actions.filter((action) => action.serves.includes(condition));
  return servers.length > 0 && !servers.some((action) => named.includes(action.request))
    ? servers.map((action) => action.request)
    : [];
}

const requestFilesLeftOut: Rule = (slice, design) => {
  const missing = (slice.meets ?? []).map((condition) => ({
    condition,
    requests: servedWithoutRequest(slice, design, condition),
  }));
  const left = missing.filter((each) => each.requests.length > 0);
  const [first] = left;
  if (first === undefined) {
    return [];
  }
  const conditions = left.map((each) => each.condition);
  const sentence =
    `${slice.name} meets ${joined(conditions)}, but its interface names the request file of no action of ` +
    `${design.file} that serves ${conditions.length === 1 ? "it" : "them"}. Name the request file of each ` +
    `action it builds, such as ${first.requests[0] ?? ""}, so the slice is given that action's rules.`;
  return [{ kind: "no request file", level: "error", slice: slice.name, conditions, sentence }];
};

const rules: readonly Rule[] = [
  namesNoInterface,
  interfaceNotCommitted,
  crossesModules,
  notVertical,
  requestFilesLeftOut,
];

export function cutFromDesignProblems(plan: Plan, design: DesignSummary): readonly CutProblem[] {
  return plan.slices.flatMap((slice) => rules.flatMap((rule) => rule(slice, design)));
}

export const heldByPlanRules = ["P-33", "P-34", "P-35"];
