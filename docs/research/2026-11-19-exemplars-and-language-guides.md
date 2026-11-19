# Exemplars and language guides

Written 2026-11-18 and 2026-11-19 for the owner and the reviewer. The question: what should builders and the reviewer be shown so that the code they write and accept is clear and well structured?

## 0. Answer in brief

Show them less, and show it better.

- Keep the kit's own practice files as the one rule set. They already agree with the canonical guides on most points. Ten changes are proposed in section 2.
- Add a small set of exemplar files, written by us, in our style, one per pattern. Do not paste whole guides or whole skill packs into a builder's context. Published studies find that long context files cost more and do not raise success.
- Let the reviewer cite the canonical guides by link when a finding needs an outside authority. The guides are for people; the reviewer is the person here.
- Install no skill pack wholesale. Take a few ideas from them.
- Whether exemplars beat rules alone is not settled by published evidence. Section 5 sets out how to measure it on one slice.

How this was read: every page was fetched on 2026-11-18 with the fetch tool, after a web search found it. GitHub repository pages mostly could not be fetched in this session, and the GitHub API was refused. Where a page could not be read, this note says so and does not describe it. Nothing was cloned. All rule text below is in my own words; no passage is copied.

---

## 1. Canonical guides per language

**Conclusion:** every language has one or two guides from its maintainers or from Google, and they agree on most of what matters to us: errors are explicit, interfaces are small, names avoid filler words, parameters stay few, and tests say what failed. They disagree on comments (they want doc comments on public items; the kit forbids comments), on exceptions (Python uses them; Go and Rust return values), and on short names (Go likes them; the others do not).

### 1.1 The guides

| Language | Guide | Publisher | URL | Licence of the text |
|---|---|---|---|---|
| TypeScript | Google TypeScript Style Guide | Google | https://google.github.io/styleguide/tsguide.html | CC-BY 3.0. The styleguide index says the guides are CC-BY 3.0 and code samples Apache 2.0: https://google.github.io/styleguide/ |
| TypeScript | Handbook, Do's and Don'ts | Microsoft (TypeScript team) | https://typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html | The page footer names no licence. An index records the docs repository `microsoft/TypeScript-Website` as CC-BY-4.0: https://repos.ecosyste.ms/hosts/GitHub/repositories/microsoft/TypeScript-Website. The repository page itself could not be fetched. |
| TypeScript | Deno style guide | Deno | https://docs.deno.com/runtime/contributing/style_guide/ | The guide says Deno code carries an MIT header. A licence for the guide's own text was not found. Not verified. |
| TypeScript (lint) | typescript-eslint shared configs | typescript-eslint | https://typescript-eslint.io/users/configs | Page shows copyright only. Not verified. |
| Python | PEP 8 | Python core developers | https://peps.python.org/pep-8 | Public domain (stated in the PEP). |
| Python | Google Python Style Guide | Google | https://google.github.io/styleguide/pyguide | CC-BY 3.0 (styleguide index). |
| Python (data) | `sqlite3` library documentation, placeholders section | Python core developers | Read from the source file mirror https://llvm.googlesource.com/third_party/cpython/+/refs/heads/main/Doc/library/sqlite3.rst (docs.python.org was not reached) | Not verified. |
| Python (layout) | src layout vs flat layout | PyPA | https://packaging.python.org/discussions/src-layout-vs-flat-layout/ | Footer says copyright PyPA; no licence named. |
| Go | Effective Go | Go team | https://go.dev/doc/effective_go | CC-BY 4.0 for text, BSD for code: https://go.dev/copyright. The page says it dates from 2009 and is no longer updated; it misses generics and modules. |
| Go | Go Code Review Comments | Go team (wiki) | https://go.dev/wiki/CodeReviewComments | The go.dev copyright page covers the site. The wiki page itself names no licence. |
| Go | Google Go Style: Decisions (normative) and Best Practices (not normative) | Google | https://google.github.io/styleguide/go/decisions and https://google.github.io/styleguide/go/best-practices | CC-BY 3.0 (styleguide index). |
| Go (data) | Avoiding SQL injection risk | Go team | https://golang.google.cn/doc/database/sql-injection (the go.dev mirror) | CC-BY 4.0 per go.dev/copyright. |
| Rust | Rust API Guidelines | Rust library team | https://rust-lang.github.io/api-guidelines/checklist.html | MIT or Apache-2.0, per the repository README: https://github.com/rust-lang/api-guidelines. The guide calls itself recommendations, not mandates. |
| Rust | The Rust Book, ch. 9.3 and 11.3 | Rust project | https://doc.rust-lang.org/stable/book/ch09-03-to-panic-or-not-to-panic.html and https://doc.rust-lang.org/stable/book/ch11-03-test-organization.html | MIT or Apache-2.0: https://rust.googlesource.com/book/+/refs/heads/main/COPYRIGHT |
| Rust | Pragmatic Rust Guidelines | Microsoft | https://microsoft.github.io/rust-guidelines/agents/all.txt | MIT (header of that file). |
| Rust | Google Rust Style Guide | Google | https://chromium.googlesource.com/external/github.com/google/styleguide/+/HEAD/rustguide.md | CC-BY 3.0 (styleguide index lists it). |

The official Rust Style Guide (https://doc.rust-lang.org/style-guide) is mostly about layout, which `rustfmt` does. Only its advice page was read.

TypeScript has no official style guide from its maintainers. The kit's own file already says so.

### 1.2 TypeScript: the rules that matter

From Google's guide unless marked.

1. **Functions.** Name a top-level function with `function`. Use arrows for callbacks and closures. Deno says the same.
2. **Function length.** About 40 lines is a signal to look for a part to split out. It is a signal, not a limit. Google Python says the same.
3. **Parameters.** Defaults are simple and have no side effects. When a call site needs a label to be read, use an options object instead. Deno is firmer: at most two required arguments, then one options object.
4. **Loops.** Use `for...of` for arrays. Never `for...in` on an array. For objects, loop over `Object.entries` and its siblings.
5. **Classes.** No class used as a namespace: export functions and constants. Prefer a module function to a static method. Getters are pure. Mark never-reassigned fields `readonly`.
6. **Types.** `unknown` over `any`. Avoid `as` and `!`; prefer a runtime check. No `@ts-ignore`. Mapped and conditional types are allowed but cost readability. Handbook: no type parameter that is unused; a union rather than overloads that differ in one argument.
7. **Errors.** Throw only `Error` objects, created with `new`. Keep `try` blocks small. An empty `catch` is rare and must be justified. A `cause` must be an `Error`. Deno adds a form for error messages: sentence case, no final period, quote values, say which action failed, then the state found and the state wanted.
8. **Modules.** Named exports only. Export only what other modules use. No mutable export (`export let`). No `namespace`, no `require`. Use `import type` for types. Deno: the entry file is `mod.ts`, never `index.ts`; files private to a folder start with `_`; no circular imports; avoid metaprogramming such as `Proxy`.
9. **Tests.** Neither guide says much. Deno puts each test file beside its source as `name_test.ts`.
10. **Lint.** typescript-eslint's `strict-type-checked` set is outside its stability promise: rules can change in a minor release.

### 1.3 Python: the rules that matter

From PEP 8 unless marked Google.

1. **Functions.** Returns are consistent: if one path returns a value, every path returns one explicitly. Bind a function with `def`, not by naming a lambda. Google: keep functions small; around 40 lines is a signal.
2. **Parameters.** Google: never a mutable default value.
3. **Loops.** Google: comprehensions and conditional expressions only for simple cases; iterate a container directly.
4. **Comparisons.** Compare to `None` with `is`. Use `isinstance`. Empty sequences are false; do not test `len`.
5. **Classes.** Google: avoid `staticmethod`; use `classmethod` only for constructors. Properties only for cheap computations. Avoid power features: metaclasses, bytecode access, `__del__`.
6. **Types.** Google: annotate public APIs and run a type checker in the build.
7. **Errors.** Derive from `Exception`, name it `...Error`. No bare `except`. Keep `try` small so it does not hide bugs. Chain with `raise ... from`. Use `with` for resources. Google: no `assert` for real checks.
8. **Modules.** Imports at the top, grouped. No wildcard imports. Declare the public surface with `__all__`; prefix internal names with `_`. Google: import modules, not single names; no mutable global state.
9. **Layout.** PyPA describes the `src` layout and the flat layout and does not pick one. The `src` layout stops tests from importing the working copy by accident.
10. **Database.** The `sqlite3` docs: never build SQL with string operations; pass values through placeholders. A connection used in `with` commits on success and rolls back on an exception, but does not close.

### 1.4 Go: the rules that matter

From Code Review Comments and Google Go Decisions unless marked.

1. **Functions.** Prefer synchronous functions; the caller adds concurrency. Context is the first parameter, never stored in a struct.
2. **Control flow.** Handle the error first and return; the normal path stays unindented, with no `else` after a return (also Effective Go).
3. **Parameters.** Best Practices: keep signatures short; use an option struct for many arguments.
4. **Loops.** `for` with `range` is the one loop form (Effective Go).
5. **Types and interfaces.** Interfaces are small and defined by the package that uses them. Return concrete types. Do not create an interface before it is needed, or only for mocking. Generics only for a real need, not for one concrete type.
6. **Errors.** Errors are values and are always handled. No in-band error values such as -1. `error` is the last result. Error strings are lowercase with no final period. Best Practices: add context only if it is new, without "failed to"; wrap with `%w` only when callers should inspect the cause; log an error where it is handled, not also where it is returned; never match on error text.
7. **Panics.** Only when the program cannot go on; never across a package boundary.
8. **Names.** Package names are short, with no `util`, `common` or `helper`. No stutter such as `bufio.BufReader`. No `Get` prefix. Short names for short scopes.
9. **State.** Best Practices: no package-level state that changes behaviour for everyone; pass instances in.
10. **Tests.** A failure message gives the function, the input, what came back and what was wanted, in that order. Use `t.Error` to keep going on independent checks. Compare whole values. Prefer real transports to fakes. Google does not use assertion libraries.
11. **Database.** go.dev: pass values as arguments with placeholders, never through `fmt.Sprintf`.

### 1.5 Rust: the rules that matter

From the API Guidelines unless marked.

1. **Functions.** No out-parameters. Microsoft: associated functions mostly for construction; other logic in plain functions. Microsoft: write I/O functions "sans-IO", taking a reader or writer, not a file.
2. **Parameters.** Use a custom type, not a `bool` or `Option`, to carry meaning. Validate arguments. Provide a builder for complex values.
3. **Types.** Newtypes for static distinctions. Private struct fields. Implement common traits, `Debug` for every public type.
4. **Errors.** The Book: return `Result` by default; panic when an invariant is broken or a caller breaks the contract. Wrap validated data in a type so checks happen once (the `Guess` example). Microsoft: an error is a situation-specific struct with a cause; panics mean stop and are not error reporting. Google: prefer pattern matching to check-then-unwrap; when a panic is meant, use `expect` with a reason.
5. **Errors in docs.** Document errors and panics on each function.
6. **Modules.** Microsoft: each public item has exactly one path. Google: non-leaf modules hold only declarations and re-exports.
7. **Names.** Conversions use `as_`, `to_`, `into_`. Microsoft: no weasel words such as `Service`, `Manager`, `Factory`.
8. **State and I/O.** Microsoft: I/O, clocks and randomness are mockable; no hidden I/O in a default constructor.
9. **Tests.** The Book: unit tests in the same file may test private items; integration tests in `tests/` use only the public API. Microsoft prefers the `tests/` kind when either would do, and forbids tautological tests that restate the code.
10. **Unsafe.** Google: only when safe code cannot do it, behind a safe wrapper, with the reason stated.
11. **Database.** None of these guides covers it.

### 1.6 Where the guides disagree

| Topic | One side | Other side |
|---|---|---|
| Doc comments on public items | Required: Google TS, PEP 8, Go Decisions, Rust API Guidelines, Microsoft Rust | No guide says none. The kit says none (P-01). All agree a comment that restates code is waste. |
| `#private` fields in TypeScript | Google: do not use them; use `private` | Deno std prefers `#`, as the kit does (TS-11) |
| Entry file that re-exports | Deno `mod.ts`, Python `__all__`, Google Rust non-leaf modules all forward names | The kit forbids a file that only re-exports (TS-12) |
| Errors | Python: exceptions are the norm | Go and Rust: values; TypeScript guides are silent on result types |
| Name length | Go: short names in short scopes, one-letter receivers | Google Rust and the kit: no abbreviations |
| Return types on exports | Google TS: author's choice | typescript-eslint rule the kit uses (TS-08) |
| Where unit tests live | Rust Book: same file, may test private items | Microsoft Rust: prefer public-API tests; the kit too (P-15, P-41) |
| Fakes for I/O | Microsoft Rust: make I/O mockable | Google Go: prefer real transports; the kit: real database (P-50) |

---

## 2. The kit's practices against the guides

**Conclusion:** the kit agrees with the guides far more than it differs. Most kit rules marked "ours" have outside support. Two kit rules go against every guide (P-01 on comments, TS-12 on re-exports); both are deliberate and should be recorded as such. The kit lacks rules on error messages, causes, `try` scope, test failure messages, module state, generics and metaprogramming.

### 2.1 Table

| Kind | Rule | Guide position | Source |
|---|---|---|---|
| Kit lacks | Error message form: what failed, the value quoted, state found and wanted | Deno; Go error strings; Microsoft panic messages | Deno style guide; Go CRC; Microsoft M-PANIC-MESSAGE |
| Kit lacks | Keep the cause; add context only if new | Go Best Practices; PEP 8 `raise from`; Google TS `cause` | as named |
| Kit lacks | Small `try`, no empty `catch` | Google TS; PEP 8; Google Python | as named |
| Kit lacks | Test failure says input, got, want; independent checks keep going | Go CRC; Go Decisions | as named |
| Kit lacks | No mutable module or global state | Google TS (mutable exports); Google Python 2.5; Go Best Practices | as named |
| Kit lacks | Generics and type-level code only for a real need | Go Decisions; Google TS (mapped and conditional types); TS handbook (unused type parameter) | as named |
| Kit lacks | No metaprogramming (`Proxy`, dynamic dispatch by string, getters with effects) | Deno; Google Python power features; Google TS pure getters | as named |
| Kit lacks | Interface defined by the user of it, holding only what it uses | Go CRC; Go Decisions; Effective Go | as named |
| Kit lacks | Function length signal near 40 lines | Google TS; Google Python | as named |
| Kit lacks | Doc comment on exported items | All guides | Contradicts P-01; see 2.2 |
| Contradicted | P-01 No comments | Every guide wants doc comments on public items | 1.6 |
| Contradicted | TS-12 "no file that only re-exports" | Deno `mod.ts`, Python `__all__`, Google Rust forward names from an entry | 1.6 |
| Contradicted in part | TS-11 `#private` | Google TS says use `private`; Deno agrees with the kit | 1.6 |
| Contradicted in part | TS-01 bans `enum` and parameter properties | Google TS allows both. The kit's reason (type stripping) is one Google does not have. | Google TS |
| Not supported | TS-08 explicit types on exports | Google TS leaves it to the author | Google TS |
| Not supported | TS-19 one loop, one job | No guide covers it directly | none found |
| Supported | P-03, TS-05 problems as values | Go, Rust Book, Microsoft Rust; Zod's `safeParse` | 1.4, 1.5, 4.2 |
| Supported | P-05, TS-02 closed sets as unions | Rust newtypes and custom types; TS handbook unions | 1.5 |
| Supported | P-06, TS-04 parse once at the edge | Rust Book `Guess`; Rust C-VALIDATE | 1.5 |
| Supported | P-08, P-37 one entry, small surface | Google TS export only what is used; Python `__all__`; Microsoft single item path | 1.2, 1.3, 1.5 |
| Supported | P-10 a port only when needed | Go: no interface before need, not for mocking | 1.4 |
| Supported | P-36 no utils, helpers, common, manager | Go CRC; Go Best Practices; Microsoft weasel words | 1.4, 1.5 |
| Supported | P-39 dependencies one way | Deno no cycles; VS Code layers | 1.2, 4.4 |
| Supported | P-44 values as parameters | `sqlite3` docs; go.dev; Kysely | 1.3, 1.4, 4.3 |
| Supported | P-45 one transaction | `sqlite3` connection context manager | 1.3 |
| Supported | P-16 literal expectations | Microsoft no tautological tests; Go compare whole values | 1.4, 1.5 |
| Supported | P-50 real database | Go prefers real transports | 1.4 |
| Supported | TS-03 no `any`, `as`, `!` | Google TS; handbook | 1.2 |
| Supported | TS-09 few parameters, then an object | Deno (two plus options); Go option structs | 1.2, 1.4 |
| Supported | TS-10 no boolean that switches behaviour | Rust C-CUSTOM-TYPE; Go Best Practices | 1.4, 1.5 |
| Supported | TS-11 class only for state | Google TS no container classes; Google Python no `staticmethod`; Microsoft regular functions | 1.2, 1.3, 1.5 |
| Supported | TS-14 `readonly` | Google TS | 1.2 |
| Supported | TS-17 outside world as an argument | Go global state; Microsoft mockable I/O | 1.4, 1.5 |
| Supported | TS-18 loop says what it makes | Google TS `for...of`; Google Python simple comprehensions | 1.2, 1.3 |
| Supported | TS-20 leave early | Effective Go; Go CRC | 1.4 |
| Supported | TS-21 decide apart from act | Microsoft sans-IO; Kysely build then execute | 1.5, 4.3 |
| Supported | TS-22 one kind of return | Go no in-band errors; PEP 8 consistent returns | 1.3, 1.4 |

### 2.2 Ten recommended changes

1. **Add TS-23, error message form.** A problem's text says which action failed, quotes the value, and gives the state found and the state wanted. Sentence case, no final period. Source: Deno style guide; Go Code Review Comments (error strings).
2. **Add to TS-05: keep the cause.** When a caught error becomes a problem value, keep the original as its cause. Add words only when they tell the caller something new. Source: Google Go Best Practices (error handling); PEP 8 (exception chaining); Google TS (`cause`).
3. **Add TS-24, narrow `try`.** Where throwing is allowed, the `try` holds only the call that may throw. A `catch` is never empty. Source: Google TS (keep try blocks focused, empty catch blocks); PEP 8; Google Python 2.4.
4. **Extend P-16: failure messages.** A failing assertion shows the input, what came back and what was wanted. Independent checks in one test all run. Source: Go Code Review Comments (useful test failures); Google Go Decisions (keep going). Add Microsoft M-TAUTOLOGICAL-TESTS as a source for P-16.
5. **Add TS-25, no module state.** No `export let`. No module-level variable that changes after load. State lives in a value passed in (TS-17). Source: Google TS (mutable exports); Google Python 2.5; Google Go Best Practices (global state).
6. **Add TS-26, plain types first.** A generic, a mapped type or a conditional type appears only when a second real caller needs it, as a port does under P-10. No unused type parameter. Source: Google Go Decisions (generics); Google TS (mapped and conditional types); TS handbook (generics).
7. **Add TS-27, no metaprogramming.** No `Proxy`, no dispatch by building property names, no getter with an effect. Explicit code even when longer. Source: Deno style guide; Google Python 2.19; Google TS (getters).
8. **Sharpen P-10: the user owns the port.** A port is declared by the module that calls it and holds only what that module uses. Source: Go Code Review Comments (interfaces); Google Go Decisions (interfaces).
9. **Add a signal to TS-16.** A function past about 40 lines is read for a part with its own name. It is a prompt to look, never a reason to split (TS-16 already says so). Source: Google TS (function length); Google Python 3.18.
10. **Record three deliberate differences in "Considered and not adopted".** Doc comments on exports (every guide); entry files that forward names (Deno, Python, Rust); `private` over `#` (Google TS). Each with the kit's reason. A reviewer who has read a guide will raise these; the record stops the same debate each slice. Source: section 1.6.

---

## 3. Skill packs and rule sets for coding agents

**Conclusion:** install none wholesale. The large packs are generic workflow advice or uneven community rules, and some carry hooks that run on the machine. Two things are worth taking: the Microsoft Rust guidelines show how to write rules aimed at agents, and the official language-server plugins give a builder compiler feedback after each edit. One Go pack reports its own evaluations; the method is worth copying, the numbers are not verified.

### 3.1 The five

| Pack | URL | Licence | Last update | What it holds | Runs code on the machine? |
|---|---|---|---|---|---|
| Anthropic official marketplace, code intelligence plugins (`typescript-lsp`, `pyright-lsp`, `gopls-lsp`, `rust-analyzer-lsp`) | https://code.claude.com/docs/en/discover-plugins.md; repository https://github.com/anthropics/claude-plugins-official | Repository Apache-2.0; each plugin has its own file | Not visible on the page | Configuration that starts a language server so diagnostics come back after every edit | Yes: the language server binary, which the user installs. Not started in cloud sessions. |
| `obra/superpowers` | https://cdn.jsdelivr.net/gh/obra/superpowers@main/README.md | MIT | Pushed 2026-04-27 per https://awesome.ecosyste.ms/projects/github.com%2Fobra%2Fsuperpowers (index may lag) | 15 workflow skills: TDD, debugging, verification before completion, plans, worktrees, code review, writing skills. No language rules. About 170k stars. | Yes: a `hooks/` folder with a SessionStart script registered by `hooks.json`, per https://www.mintlify.com/obra/superpowers/development/architecture (secondary). |
| `PatrickJS/awesome-cursorrules` | https://raw.githubusercontent.com/PatrickJS/awesome-cursorrules/main/README.md | CC0-1.0 | Not verified. One index is stale at 2024: https://awesome.ecosyste.ms/projects/github.com%2FPatrickJS%2Fawesome-cursorrules | Hundreds of `.mdc` rule files by many contributors, mostly per framework (React, FastAPI, Django). About 39.7k stars per https://ossinsight.io/analyze/PatrickJS/awesome-cursorrules. No review process stated. | No: text only. |
| `wshobson/agents` | Read only through https://www.heyuan110.com/posts/ai/2026-04-20-wshobson-agents-deep-dive/ (secondary) | Not verified | Article dated 2026-04-20 | 78 plugins, about 150 skills, 184 agents. Language plugins for Python, TypeScript and others. Its `typescript-advanced-types` is the most installed TypeScript skill (54.6k) per https://claudeskills.info/best/typescript-skills/ | Yes, in some plugins: a PreToolUse hook (`block-no-verify`), an eval CLI. |
| `samber/cc-skills-golang` | https://cdn.jsdelivr.net/gh/samber/cc-skills-golang@main/README.md | MIT | Not verified | 46 Go skills, distilled from the author's commits and edited by hand | None mentioned in the README. |

Also read, not in the five:

- **Microsoft Pragmatic Rust Guidelines** (https://microsoft.github.io/rust-guidelines/agents/all.txt, MIT). Not a skill pack. A rule set published as one text file for agents, with an AI section: https://microsoft.github.io/rust-guidelines/guidelines/ai/index.html. The best-made rule set found for agents.
- **Repackaged Google guides.** `pproenca/dot-skills` `ts-google` (386 installs, https://skills.sh/pproenca/dot-skills/ts-google) and `testdino-hq/google-styleguides-skills` (26 installs, https://skills.sh/testdino-hq/google-styleguides-skills/typescript). The testdino skill lists explicit return types on public functions as a Google rule. Google's guide leaves that to the author. A summary can drift from its source.
- **Python.** No Python pack was verified to a standard worth listing. Many exist under names such as `python-pro`; none was read in full.
- The top ten skills by installs hold no language style skill: https://dev.to/skillselion/the-entire-claude-code-skills-top-10-belongs-to-three-authors-anthropic-holds-one-slot-27jc (secondary, data of 29 July).

### 3.2 Honest view of quality

- **Popularity is not quality.** Install counts measure reach. A critic of `wshobson/agents` called its agents too broad and generic, and the reviewing author agreed many language agents are capability lists, not expert prompts (secondary source above).
- **Community rule collections are uneven.** awesome-cursorrules states format rules for contributions but no review. Rules are framework-specific and written by many hands.
- **Hooks are code.** Anthropic's own docs say plugins can run arbitrary code with the user's rights. In agentbay, only the agentbay hook may confine a step. A pack that adds its own SessionStart or PreToolUse hook would sit beside it.
- **Self-reported evals are a good sign, not proof.** samber reports 97% correct with the skills and 57% without, over 3,439 checks. The method and data are in the author's repository and were not checked here.

### 3.3 Ideas worth taking

1. From Microsoft Rust: write rules with stable ids and a short reason, and name agent failure modes outright: duplicate paths to one item after a refactor, design history written into docs, tests that restate the code, patterns carried over from another language.
2. From the official LSP plugins: diagnostics after every edit. Worth a trial for local builds only. Measure it under section 5 before adopting.
3. From superpowers: "verification before completion" matches P-19. Its separate eval harness for skills matches P-32.
4. From samber: measure each skill with and without, on the same tasks.

---

## 4. Exemplary TypeScript projects

**Conclusion:** four projects show a pattern the kit teaches, and all four are MIT or reported as MIT. None is AGPL or GPL, so none is limited to ideas only by licence. Still, no code is copied: the examples below are mine. Evidence that each is "widely held up" is thin; the choice rests on stars and on the pattern fitting the kit.

### 4.1 Deno standard library: a sibling test for every file

- Licence: MIT per Deno's header rule in its style guide. The repository licence file was not read.
- Read: https://deno.land/std@0.223.0/.github/ARCHITECTURE.md?source= and the entry file https://github.com/denoland/deno_std/blob/0.184.0/http/mod.ts (an older tag).
- Pattern: each package has one entry file. Each source file has a test file beside it with the same name and a `_test` suffix. A file whose name starts with `_` is private to its folder.
- What to teach: the sibling test and the underscore mark. Not the entry file itself: Deno's entry only forwards names, which TS-12 forbids.

```
todos/
  todos.ts
  todos_test.ts
  _ids.ts
  _ids_test.ts
```

### 4.2 Zod: two doors, one that returns problems

- Licence: MIT, 42.5k stars, pushed 2026-04-29: https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fcolinhacks%2Fzod
- Read: https://zod.dev/basics. A source file path was not verified.
- Pattern: `parse` throws; `safeParse` never throws and returns a tagged result. The failure carries every issue found, each with a path and a message.
- What to teach: at the edge, return a tagged value with all problems, not the first (TS-04, TS-05).

```ts
type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] };

function parsePort(text: string): Parsed<number> {
  const port = Number(text);
  const problems = [
    ...(Number.isInteger(port) ? [] : [`Reading the port: "${text}" is not a whole number`]),
    ...(port >= 1 && port <= 65535 ? [] : [`Reading the port: "${text}" is outside 1 to 65535`]),
  ];
  return problems.length === 0 ? { ok: true, value: port } : { ok: false, problems };
}
```

### 4.3 Kysely: build the query, then run it

- Licence: MIT, 14.3k stars: https://ossinsight.io/analyze/kysely-org/kysely
- Read: https://kysely.dev/docs/recipes/splitting-query-building-and-execution. A source file path was not verified.
- Pattern: compiling a query gives a plain object holding the SQL text with numbered placeholders and a separate list of values. Building needs no database; running is a separate step.
- What to teach: a pure function decides the statement; a thin function runs it (TS-21). Values never enter the text (P-44).

```ts
type Statement = { readonly text: string; readonly values: readonly unknown[] };

function openTodos(owner: string, limit: number): Statement {
  return {
    text: "select id, text from todos where owner = ? and status = 'open' limit ?",
    values: [owner, limit],
  };
}
```

### 4.4 VS Code: layers that only point down, held by a check

- Licence: not verified in this session. The index page for the repository was refused.
- Read: only a secondary page generated from the repository, https://www.mintlify.com/microsoft/vscode/concepts/layered-architecture. The official page https://github.com/microsoft/vscode/wiki/Source-Code-Organization could not be fetched, so its content is not described here.
- Pattern, per the secondary page: four layers (`base`, `platform`, `editor`, `workbench`); each may import only the layers below it; `common` folders hold code that runs anywhere and `browser` folders code that needs a browser; a script, `npm run valid-layers-check`, fails on a violation.
- What to teach: P-39 with a check, as the kit's feature map test already does. Splitting by where code may run (`common` against a runtime) is the new idea.

```
shop/
  core/      imports nothing above it
  orders/    imports core
  commands/  imports orders and core
```

Considered and left out: neverthrow (MIT, https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fsupermacro%2Fneverthrow) teaches a result type, which the kit already has as `Outcome`.

---

## 5. Do examples beat rules alone?

**Conclusion:** no published study answers this for code quality. Studies find that examples raise correctness on small tasks but can raise code smells, that the choice of example matters a lot, and that context files for agents cost more without raising success. So measure it here, on one slice, by review findings.

### 5.1 What exists

- **Context files for agents.** Gloaguen and others, arXiv 2602.11988 (February 2026, revised September 2026): context files, whether written by a model or by developers, did not raise task success and raised cost by more than a fifth. Agents did follow the instructions. Repository overviews did not help. The authors say such files suit non-standard practices and should be evaluated before use. https://arxiv.org/abs/2602.11988
- **A second ablation.** Khatri, arXiv 2607.27250 (July 2026): Claude Code and Codex on 17 Python tasks, with no guide, a full guide, and guides read on demand. No measurable effect on correctness, but the study can only detect effects above 30 points. It does not measure style or quality. https://www.alphaxiv.org/abs/2607.27250
- **Examples and quality.** Khojah and others, arXiv 2412.20545: two examples in the prompt (with the function signature) raised correctness the most of five techniques, but went with more code smells and higher complexity. Combining techniques rarely helped. https://arxiv.org/html/2412.20545v2
- **Choosing examples.** Xu and others, arXiv 2412.02906 (December 2024): one example usually helps, the best example helps far more than an average one, gains level off near six examples, and ten examples doubled the time. https://arxiv.org/html/2412.02906v1
- **Style drift.** Wang and others, arXiv 2407.00456: model code differs in style from developers' code in readability, conciseness and robustness. The abstract does not say whether examples fix it. https://arxiv.org/abs/2407.00456v2
- **Vendor advice.** Anthropic recommends three to five varied, relevant examples, marked apart from instructions, so the model does not pick up an unintended pattern. This is advice, not a measurement. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/multishot-prompting

What this suggests for the kit: a few short, chosen exemplars may help style; a long rule file is unlikely to help and will cost. Neither is proven for code quality.

### 5.2 How to measure it here

1. **Pick one slice** whose brief is already merged, with a narrow write scope and a database step, so most practices apply.
2. **Two arms from the same commit and the same brief.** Arm A: practices files as today. Arm B: the same plus three exemplar files written to the patterns above (sibling tests, problems as values with all problems, decide then act).
3. **Repeat.** Three fresh builders per arm, same model, same time limit. Runs vary; one run each proves nothing.
4. **Blind review.** One reviewer, a different model from the builders (P-27), sees each result without the arm named. It uses the kinds from `docs/research/2026-11-15-quality-evaluation.md`: defect, risk, smell, taste.
5. **Measure.** Findings by kind per hundred changed lines; whether `npm run check` passes first time; how many injected bugs the tests catch (P-18); lines changed; tokens and cost.
6. **Decide in advance.** Adopt exemplars if defects plus smells fall by a third or more in every repeat and cost rises less than a fifth. Otherwise drop them. Six runs cannot detect small effects, so a small difference means "no evidence", not "no effect".
7. **Then the next variable.** Run the same test for the language-server plugin and for the ten rule changes in section 2.2, one at a time.

---

## 6. What could not be verified

- GitHub repository pages and the GitHub API were mostly refused in this session. Last update dates for awesome-cursorrules, claude-plugins-official, wshobson/agents and samber/cc-skills-golang are not verified. The licence of wshobson/agents is not verified.
- The VS Code wiki page and the VS Code licence were not read. Section 4.4 rests on a secondary page.
- Source file paths in Zod and Kysely were not verified; the links go to their documentation.
- The licence of the Deno style guide text, the typescript-eslint docs, the `sqlite3` docs and the PyPA page were not found.
- The TypeScript handbook's CC-BY-4.0 licence comes from an index, not from the repository.
- Google's TypeScript guide was read in two parts; its full comment section was read only in summary.
- The samber evaluation numbers and the wshobson counts are the authors' or a reviewer's claims.
- No study was found that compares examples with rules on code quality for coding agents.
