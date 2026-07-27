// scripts/secrets-baseline.test.ts
// RED->GREEN spec for the repo-wide detect-secrets BASELINE op.
//
// Why this exists. detect-secrets runs in pre-commit as
//   - id: detect-secrets
//     args: ['--baseline', '.secrets.baseline']
// so the hook only blocks findings that are NOT already recorded in the
// tracked baseline. When a branch adds files that legitimately contain
// credential-SHAPED (but synthetic) strings -- test fixtures with
// randomBytes passwords, SHA-256 topology hashes, script names containing the
// word 'secrets' -- the baseline must be refreshed or EVERY worktree's push is
// blocked. That is exactly what happened when the security-guard arc landed
// seven new scripts without regenerating the baseline.
//
// Before this task the refresh was an un-captured CLI incantation, so nobody
// could rediscover it and the flags could drift from the hook's. Registering it
// as //#secrets:baseline makes the op reusable and keeps ONE definition of the
// scan flags. The pure planners below are what the contract test pins; the
// side-effecting main() runs only as entrypoint.
//
// 2026 practice this encodes: prefer an AUDITED baseline over scattered inline
// pragmas for genuine false positives -- the baseline is reviewable in a PR,
// stores hashes rather than plaintext, and gives an audit trail. Pragmas are
// detect-secrets-only and drift silently.
import { describe, it, expect } from 'vitest';
import {
  BASELINE_FILE,
  EXCLUDE_PATTERNS,
  scanArgs,
  auditArgs,
  selectMode,
  pickDetectSecretsBinary,
} from './secrets-baseline.ts';

describe('BASELINE_FILE', () => {
  it('is the tracked baseline the pre-commit hook reads', () => {
    expect(BASELINE_FILE).toBe('.secrets.baseline');
  });
});

describe('scanArgs', () => {
  it('scans WITH the existing baseline so prior audit decisions survive', () => {
    const args = scanArgs(BASELINE_FILE);
    expect(args[0]).toBe('scan');
    expect(args).toContain('--baseline');
    expect(args[args.indexOf('--baseline') + 1]).toBe(BASELINE_FILE);
  });
  it('never writes the baseline by shell redirection (that would DROP audits)', () => {
    // detect-secrets scan > .secrets.baseline discards every is_secret label
    // recorded by a previous audit. Passing --baseline updates in place.
    const args = scanArgs(BASELINE_FILE);
    expect(args).not.toContain('>');
  });
  it('excludes the same machine-generated files the pre-commit hook excludes', () => {
    const args = scanArgs(BASELINE_FILE);
    const joined = args.join(' ');
    for (const p of EXCLUDE_PATTERNS) {
      expect(joined).toContain(p);
    }
  });
  it('excludes the baseline itself (it stores hashes that look high-entropy)', () => {
    expect(EXCLUDE_PATTERNS.some((p) => p.includes('secrets'))).toBe(true);
  });
});

describe('auditArgs', () => {
  it('audits the baseline so each finding is labelled true or false positive', () => {
    const args = auditArgs(BASELINE_FILE);
    expect(args[0]).toBe('audit');
    expect(args).toContain(BASELINE_FILE);
  });
});

describe('selectMode', () => {
  it('defaults to scan (refresh the baseline non-interactively)', () => {
    expect(selectMode([])).toBe('scan');
  });
  it('selects audit when --audit is passed', () => {
    expect(selectMode(['--audit'])).toBe('audit');
  });
  it('ignores a bare -- separator that pnpm forwards as argv[0]', () => {
    // pnpm run <script> -- --audit hands the literal -- through; the mode must
    // still resolve (same class of bug fixed in gate-integration.ts).
    expect(selectMode(['--', '--audit'])).toBe('audit');
    expect(selectMode(['--'])).toBe('scan');
  });
});

// The baseline MUST be written by the same detect-secrets the hook enforces
// (.pre-commit-config.yaml pins rev v1.5.0). pre-commit already installs that
// exact version into its managed virtualenv, so the task prefers that binary
// over any PATH copy: a second, independently-installed detect-secrets could
// write a baseline the hook then rejects, which is version drift by
// construction.
describe('pickDetectSecretsBinary', () => {
  it('prefers a pre-commit managed binary when one is present', () => {
    const found = ['/home/u/.cache/pre-commit/repoX/py_env-python3.13/bin/detect-secrets'];
    expect(pickDetectSecretsBinary(found)).toBe(found[0]);
  });
  it('falls back to the bare command name when none is found', () => {
    expect(pickDetectSecretsBinary([])).toBe('detect-secrets');
  });
  it('is deterministic when several envs exist (picks the first)', () => {
    const found = ['/a/detect-secrets', '/b/detect-secrets'];
    expect(pickDetectSecretsBinary(found)).toBe('/a/detect-secrets');
  });
});
