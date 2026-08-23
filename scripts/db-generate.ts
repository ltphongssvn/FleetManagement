// ============================================================================
// File:     FleetManagement/scripts/db-generate.ts
// Purpose:  Run drizzle-kit generate and FAIL LOUDLY when it does not succeed.
//
// Why this exists (root cause, 2026-07-16):
//   drizzle-kit prints fatal schema-load errors and STILL EXITS 0. turbo
//   therefore reports Tasks: 1 successful on a crash, and CI sees green. This
//   is not hypothetical: PR #313 made manifest.ts import @fleet/domain, whose
//   exports map lacked a require/default condition, so drizzle-kit CJS died
//   with ERR_PACKAGE_PATH_NOT_EXPORTED on every run. db:generate stayed
//   BROKEN ON MAIN for days and nothing went red. PR #333 fixed the
//   resolution; this task fixes the blindness that hid it, which is the more
//   durable defect: the next schema error would have been invisible too.
//
//   The exit code cannot be trusted, so the OUTPUT is the contract. A run is
//   a success only when drizzle-kit affirmatively says so -- either it wrote a
//   migration, or it confirmed there was nothing to write. Absence of a
//   success marker is a failure, not a pass: that is what turns a silent
//   crash into a red build.
//
// Purity: decideDbGenerate is pure (no child_process, no fs) so every branch
//   is unit-testable -- the sync-develop.ts lesson, where the verdict is
//   welded to execFileSync and consequently has no test at all.
//
// Related files:
//   - scripts/db-generate.test.ts (9 cases)
//   - turbo.jsonc  (db:generate task)
//   - apps/api/package.json (db:generate script)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
export const DbGenerateObservationSchema = z.object({
  exitCode: z.number().int(),
  output: z.string(),
});
export type DbGenerateObservation = z.infer<typeof DbGenerateObservationSchema>;
export const DB_GENERATE_FAILURE_REASONS = [
  'nonzero-exit',
  'module-resolution',
  'error-output',
  'no-success-marker',
] as const;
export type DbGenerateFailureReason = (typeof DB_GENERATE_FAILURE_REASONS)[number];
export type DbGenerateVerdict =
  | { action: 'pass'; reasons: [] }
  | { action: 'fail'; reasons: DbGenerateFailureReason[] };
// Affirmative success markers drizzle-kit prints. One of these MUST appear.
const SUCCESS_MARKERS = [
  'No schema changes, nothing to migrate',
  'Your SQL migration file has been created',
] as const;
// Anchored to a line start so a table or column named error_log cannot trip
// it -- the output lists every introspected table.
const ERROR_LINE = /^\s*(Error|TypeError|RangeError|SyntaxError)\b/m;
const MODULE_RESOLUTION = /ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_MODULE_NOT_FOUND|Cannot find module/;
export function decideDbGenerate(raw: DbGenerateObservation): DbGenerateVerdict {
  const obs = DbGenerateObservationSchema.parse(raw);
  const reasons: DbGenerateFailureReason[] = [];
  if (obs.exitCode !== 0) reasons.push('nonzero-exit');
  if (MODULE_RESOLUTION.test(obs.output)) reasons.push('module-resolution');
  else if (ERROR_LINE.test(obs.output)) reasons.push('error-output');
  const succeeded = SUCCESS_MARKERS.some((m) => obs.output.includes(m));
  if (!succeeded && reasons.length === 0) reasons.push('no-success-marker');
  if (reasons.length > 0) return { action: 'fail', reasons };
  return { action: 'pass', reasons: [] };
}
/* v8 ignore start -- CLI shell: exercised via db:generate, logic above is unit-tested */
function main(): number {
  let exitCode = 0;
  let output: string;
  try {
    output = execFileSync('drizzle-kit', ['generate'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    exitCode = typeof e.status === 'number' ? e.status : 1;
    output = (e.stdout ?? '') + (e.stderr ?? '');
  }
  process.stdout.write(output);
  const verdict = decideDbGenerate({ exitCode, output });
  if (verdict.action === 'fail') {
    process.stderr.write(
      '[db:generate] FAILED: ' + verdict.reasons.join(', ') + String.fromCharCode(10),
    );
    process.stderr.write(
      '[db:generate] drizzle-kit exit code was ' +
        String(exitCode) +
        ' -- it is unreliable, the output above is the contract.' +
        String.fromCharCode(10),
    );
    return 1;
  }
  return 0;
}
// Entrypoint guard (compose-identity.ts precedent): without it, importing this
// module for its pure core would EXECUTE drizzle-kit as a side effect -- which
// is exactly what the first test run caught.
const isMain = process.argv[1]?.endsWith('db-generate.ts') ?? false;
if (isMain) {
  process.exit(main());
}
/* v8 ignore stop */
