# TypeScript standards

The configs that hold agentbay code to the code standards of proposal 0022. The scripts in the root `package.json` pass these files with `--config`, so no copy sits at the repository root. `tsconfig.json` stays at the root because the compiler and the type-checked lint rules look for it there.

| File | Used by | Enforces |
|---|---|---|
| `eslint.config.js` | `npm run lint` | typescript-eslint `strictTypeChecked`; no `any`; no non-null `!`; no type assertion except `as const`; every `switch` over a union is exhaustive; exported functions state their parameter and return types; at most three parameters; complexity at most 10; no nested ternary; no reassigned parameter; no default export; no `enum`; no class `extends`; no `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`; inline `eslint-disable` comments have no effect and are reported, and `--max-warnings 0` fails on them; files under `components/` import from `bay/` only `bay/sdk.ts` and use no dynamic `import()`; files under `adapters/` import from `bay/` only `bay/sdk.ts` and `bay/adapter.ts`; files under `bay/` other than `cli.ts` and `mcp.ts` import neither `cli.ts`, `mcp.ts` nor anything under `adapters/` |
| `prettier.json` | `npm run format:check` | Prettier with a line width of 120 |
| `knip.json` | `npm run deadcode` | No unused file, export or dependency. Test files are the entry points until `bay/cli.ts` exists |

Not enforced here: import cycles and files that only re-export (they need an eslint plugin, so `bay check` will do it), and comment lines in kit code (a `bay check` measure).
