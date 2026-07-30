// scripts/worktree-deps-status.ts
// Pure decision core for two-tier dependency-drift detection. No I/O here;
// the driver in sync-worktrees.ts gathers timestamps and runs the probe.
//
// WHY THIS EXISTS. pnpm v11 defaults verifyDepsBeforeRun to install, healing a
// drifted node_modules before every script. This repo sets it to warn on
// purpose: with 37 worktrees and 1810 packages on a 9.7GiB box an implicit
// install mid-gate is destructive, and pnpm issues 11556 and 11865 document it
// polluting script output and firing on filtered exec. warn only prints,
// though, and sync:worktrees fast-forwards refs without touching node_modules
// -- so drift accumulates silently. Observed: the canonical root ran
// sync:worktrees on turbo 2.10.6 while origin/main and origin/develop both
// declared 2.10.7.
export interface DepsCandidateInput {
  stateFilePresent: boolean;
  lastValidatedTimestampMs: number;
  newestManifestMtimeMs: number;
}
export type DepsCandidate =
  | { kind: 'no-state' }
  | { kind: 'suspect'; staleByMs: number }
  | { kind: 'ok' };
// TIER 1 (free). node_modules/.pnpm-workspace-state-v1.json is the same state
// file pnpm own checkDepsStatus reads, and lastValidatedTimestamp is when pnpm
// last confirmed the tree. Any manifest written after that instant means the
// tree MAY be stale. Deliberately one-directional: this can over-suspect and
// tier 2 clears it, but it cannot under-suspect, because a real install always
// rewrites the timestamp.
export function classifyDepsCandidate(input: DepsCandidateInput): DepsCandidate {
  if (!input.stateFilePresent) return { kind: 'no-state' };
  const staleByMs = input.newestManifestMtimeMs - input.lastValidatedTimestampMs;
  // Strictly greater: an equal timestamp is the install itself, not drift.
  if (staleByMs > 0) return { kind: 'suspect', staleByMs };
  return { kind: 'ok' };
}
export type DepsProbe =
  | { kind: 'deps-ok' }
  | { kind: 'deps-stale'; reason: string }
  | { kind: 'toolchain-blocked'; reason: string };
const VERIFY_CODE = 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN';
const PNPM_VERIFY_TAG = '[' + VERIFY_CODE + ']';
const PNPM_ERROR_TAG = '[ERROR]';
const NO_OUTPUT_REASON = 'probe failed with no diagnostic output';
// Both streams, joined. pnpm does not commit to one: its tracker documents WARN
// lines landing on stdout and breaking --json parsing (issues 10200, 10923),
// and verify-deps data reaching stdout even under --silent (issue 11636). The
// first working run reported every drifted worktree as no-diagnostic-output
// because only stderr was read. Guessing the stream is a treadmill; reading
// both is stable across releases. A killed process yields undefined, not empty.
export function joinProbeStreams(
  stderr: string | undefined,
  stdout: string | undefined,
): string {
  const NL = String.fromCharCode(10);
  return [stderr ?? '', stdout ?? '']
    .filter((s) => s.length > 0)
    .join(NL);
}
interface PnpmErrorRecord {
  code: string;
  message: string;
}
// Narrows an unknown parsed line to a pnpm error record. JSON.parse returns any,
// so the value is walked through unknown with explicit checks rather than cast.
// The type-aware no-unsafe-member-access rule rejects the cast, and rightly:
// this data comes from a subprocess, which is a trust boundary.
function toErrorRecord(value: unknown): PnpmErrorRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const err = (value as { err?: unknown }).err;
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  const message = (err as { message?: unknown }).message;
  if (typeof code !== 'string') return null;
  return {
    code,
    message: typeof message === 'string' ? message : code,
  };
}
function findErrorRecord(lines: string[]): PnpmErrorRecord | null {
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = toErrorRecord(parsed);
    if (rec !== null) return rec;
  }
  return null;
}
// TIER 2 (authoritative). Interprets a pnpm invocation that reuses pnpm own
// checkDepsStatus WITHOUT changing the repo-wide setting and without adding a
// dependency. Not pnpm install --dry-run: that exits 0 even when it reports a
// real install would change the lockfile, so it can never gate -- the
// confident-zero hazard audit:ci-minutes refuses.
//
// NDJSON FIRST. pnpm errors are structured PnpmError objects carrying ERR_PNPM_
// codes, and --reporter=ndjson emits them as records. Parsing a documented
// machine format beats scraping human prose that any release may reword, and
// line-oriented parsing tolerates the interleaved WARN noise pnpm is known to
// mix in. The prose parser remains as a fallback: a reporter that emits nothing
// recognisable must still never read as a pass.
//
// THREE outcomes. The first live run found four worktrees pinning pnpm@11.13.0,
// which pnpm REFUSES to install: 11.13.1 through 11.16.0 shipped tarballs
// missing most compiled files (issue 13164, since republished) and 11.13.0 broke
// Linux installs outright (issue 13067). pnpm cannot run there at all, so the
// probe fails for a reason that is not drift. Calling that deps-stale would send
// someone to run pnpm install where pnpm itself is the broken thing.
//
// FAILS CLOSED, mirroring gate:agent: only an explicit 0 is a pass. A null code
// (timeout SIGTERM) or unparseable output still reports stale.
export function interpretDepsProbe(
  exitCode: number | null,
  output: string,
): DepsProbe {
  if (exitCode === 0) return { kind: 'deps-ok' };
  const NL = String.fromCharCode(10);
  const lines = output.split(NL).map((l) => l.trim());
  const record = findErrorRecord(lines);
  if (record !== null) {
    return record.code === VERIFY_CODE
      ? { kind: 'deps-stale', reason: record.message }
      : { kind: 'toolchain-blocked', reason: record.message };
  }
  const verify = lines.find((l) => l.startsWith(PNPM_VERIFY_TAG));
  if (verify !== undefined) {
    return {
      kind: 'deps-stale',
      reason: verify.slice(PNPM_VERIFY_TAG.length).trim(),
    };
  }
  const toolchain = lines.find((l) => l.startsWith(PNPM_ERROR_TAG));
  if (toolchain !== undefined) {
    return {
      kind: 'toolchain-blocked',
      reason: toolchain.slice(PNPM_ERROR_TAG.length).trim(),
    };
  }
  const firstLine = lines.find((l) => l.length > 0);
  return { kind: 'deps-stale', reason: firstLine ?? NO_OUTPUT_REASON };
}
export const VERIFY_DEPS_ENV_KEY = 'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN';
const STRIP_PREFIXES = ['npm_', 'pnpm_config_'];
const STRIP_EXACT = ['init_cwd', 'pnpm_script_src_dir'];
// CONFIDENT-ZERO GUARD, and the root cause of a real bug in this very file.
//
// The probe is spawned from INSIDE a pnpm process. pnpm v11 ignores .npmrc and
// reads env config from the PNPM_CONFIG_ namespace, so verifyDepsBeforeRun: warn
// in pnpm-workspace.yaml reaches the child as
// PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=warn -- and ENV CONFIG OUTRANKS THE
// --config. FLAG. The probe was silently downgraded to warn: it exited 0 in
// ~0.5s inside the task while the identical command took ~7.7s and exited 1
// standalone, same cwd, same argv. Every stale worktree read as healthy.
//
// A first attempt stripped npm_config_ only. That is the pnpm v10 namespace; v11
// does not read it, so the fix changed nothing and the bug survived it.
//
// So the setting is FORCED through the highest-precedence channel rather than
// requested through a lower one, and the inherited config + lifecycle namespaces
// are stripped so nothing upstream can contradict it. pnpm injects INIT_CWD and
// PNPM_SCRIPT_SRC_DIR into every child; npm_execpath, npm_lifecycle_* and
// npm_package_* mark the child as a nested run.
//
// PNPM_HOME deliberately SURVIVES: it locates the binary rather than configuring
// behaviour, and stripping it can leave pnpm unresolvable. undefined values are
// dropped so spawn never receives them.
export function buildProbeEnv(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (STRIP_PREFIXES.some((pre) => lower.startsWith(pre))) continue;
    if (STRIP_EXACT.includes(lower)) continue;
    out[k] = v;
  }
  out[VERIFY_DEPS_ENV_KEY] = 'error';
  return out;
}
