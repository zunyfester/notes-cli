# Notes CLI

A tiny command-line notes app in TypeScript: `node src/cli.ts add <text> | list | search <text> | delete <id>`.
Node 24+ runs the TypeScript directly (type stripping): there is no build step and no `dist/`.

## How the code is organized
- `src/notes.ts`: the domain. `Note { id, text, created }`, `NotesError`, and pure functions that take a
  `Note[]` and return a new one or a string (`addNote`, `deleteNote`, `searchNotes`, `formatList`, `localDate`).
  Only `loadNotes` / `saveNotes` touch the disk. Never mutate the array you get; return a new one.
- `src/cli.ts`: `run(argv, file, today): { code, out }` parses arguments, calls `notes.ts` and returns the text
  to print. It has no logic of its own. The `if (import.meta.main)` block is the only place that reads
  `process.argv`, `NOTES_FILE` and the clock, so `run` stays testable.
- `test/notes.test.ts`: vitest. Unit tests per function, plus `describe("cli …")` tests that call `run` on a
  temp file (`tmpFile()`) with a fixed date (`DAY`). Add your tests here, following the same pattern.
- A new command means: a pure function in `notes.ts`, a branch in `run`, the usage line in `USAGE` and in the
  comment at the top of `cli.ts`, and tests for both the function and the CLI.

## Behaviour to keep
- Exit codes: `0` success (including "no results"), `1` user error (`error: <message>`), `2` unknown
  command (prints usage). Throw `NotesError` for user errors. Anything else is a bug and must propagate.
- Ids are `max id + 1` and are never reused or renumbered. Dates are `YYYY-MM-DD` in local time (`localDate`).
- Commands that only read (`list`, `search`) must never write `notes.json`.
- Existing output strings are a contract: tests check them exactly. Change one only if the ticket asks for it.

## Running the tests
- Tests: `npm test --silent` (vitest). Type check: `npm run lint --silent` (`tsc --noEmit`, strict).
  These are TEST_CMD and LINT_CMD in factory.conf. Run them exactly as written, and both must pass.
- TDD: write the failing test first, see it fail, then implement. Tests check behaviour (inputs and outputs
  of `run` or the pure functions), not internals. Never call the clock or the real `notes.json` in a test.

## Conventions
- TypeScript strict, erasable syntax only (no `enum`, `namespace` or parameter properties).
  Relative imports end in `.ts`. Use `import type` / `type` for types (`verbatimModuleSyntax`).
- Only Node built-ins (`node:fs`, `node:path`, …). There are no runtime dependencies, and none can be added.
- Functions under 30 lines. Small, focused diffs: change only what the ticket needs.

## What you must not change
- Only paths in SCOPE (`src/`, `test/`) may change. Anything else stops the run with `[REJECTED]`.
- Never edit: `AGENTS.md`, `factory.sh`, `factory.conf`, `doctor.sh`, `.gitignore`, `lib/`, `gates/`,
  `dashboard/`, `.claude/`, `package.json`, `package-lock.json`, `tsconfig.json`, `node_modules/`.
- No new dependencies. `gates/no-new-deps.sh` rejects any import in `src/` that is not a built-in or a
  relative file. If a ticket asks for a library (e.g. colors), do the closest thing with built-ins
  (e.g. plain ANSI codes) or leave it out, and say so in your phase file.
- Do not delete or weaken existing tests to make yours pass.
- Phase state lives in `.factory/*.md`. Never put plan or review text in code comments.
