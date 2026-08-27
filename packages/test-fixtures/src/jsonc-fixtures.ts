// packages/test-fixtures/src/jsonc-fixtures.ts
// Parse a JSONC file (comments + trailing commas) with a REAL parser.
//
// WHY THIS EXISTS. Four guards each carried their own copy of the same
// hand-rolled parser: strip every line starting with `//`, then JSON.parse the
// remainder. That is wrong twice over, and both failures are live.
//
// (1) TRAILING COMMAS. Prettier's trailingComma:"all" -- this repo's committed
// setting -- emits `},` before a closing brace. JSON.parse rejects it outright,
// so formatting turbo.jsonc broke all four guards at once with
// "Expected double-quoted property name in JSON".
//
// (2) IT CORRUPTS THE VERY KEYS IT IS READING. Turbo's root-task convention is
// the `//#` PREFIX -- "//#format", "//#test:scripts", "//#estate:verify" -- and
// a line-comment stripper deletes any line whose first non-space characters are
// two slashes. So the stripper silently ATE the root task definitions it was
// written to inspect. Verified the hard way: an identical regex validator
// written during this session reported turbo.jsonc as malformed while turbo
// itself parsed it fine.
//
// THE FIX IS NOT A BETTER REGEX, because the property is not lexical. A comment
// and a `//#` key are distinguishable only by a parser that understands JSON
// structure -- inside a string literal, `//` is data. TypeScript already ships
// that parser and uses it for tsconfig.json, which is itself JSONC: comments and
// trailing commas both permitted.
//
// ONE COPY, not four. The duplication was the root cause: each guard could be
// fixed independently and drift independently, which is the same defect the
// eslint config's own lint-as-architecture note records about six copies of a
// timing budget.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Parse JSONC text. Throws with the file path and the parser's own diagnostic
 *  rather than returning a partial object -- a guard that reads a malformed
 *  config as an empty one passes vacuously, which is worse than failing. */
export function parseJsonc(text: string, path: string): unknown {
  const result = ts.parseConfigFileTextToJson(path, text);
  if (result.error !== undefined) {
    const detail = ts.flattenDiagnosticMessageText(result.error.messageText, ' ');
    throw new Error('failed to parse ' + path + ': ' + detail);
  }
  return result.config;
}

/** Read and parse a JSONC file from disk. */
export function readJsonc(path: string): unknown {
  return parseJsonc(readFileSync(path, 'utf8'), path);
}

/** The shape every turbo guard actually asks about. Narrowed here once so no
 *  caller re-derives it, and so a structural change fails in one place. */
export interface TurboTask {
  readonly dependsOn?: readonly string[];
  readonly description?: string;
  readonly cache?: boolean;
}

/** Read turbo.jsonc and return its task table.
 *  Throws when the file parses but carries no tasks -- an empty table would
 *  make every "task X is registered" assertion below it fail confusingly, and
 *  every "task X is absent" assertion pass vacuously. */
export function readTurboTasks(path: string): Record<string, TurboTask> {
  const config = readJsonc(path);
  if (typeof config !== 'object' || config === null || !('tasks' in config)) {
    throw new Error('turbo config at ' + path + ' has no tasks key');
  }
  const tasks = (config as { tasks: unknown }).tasks;
  if (typeof tasks !== 'object' || tasks === null) {
    throw new Error('turbo tasks at ' + path + ' is not an object');
  }
  const table = tasks as Record<string, TurboTask>;
  if (Object.keys(table).length === 0) {
    throw new Error('turbo tasks at ' + path + ' is empty');
  }
  return table;
}
