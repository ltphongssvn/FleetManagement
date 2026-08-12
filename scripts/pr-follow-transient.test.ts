// scripts/pr-follow-transient.test.ts
// RED->GREEN: a TRANSIENT network blip must not kill a 25-minute watcher.
//
// THE CRASH, observed live on 2026-08-10 while following PR #550:
//   error connecting to api.github.com
//   SyntaxError: Unexpected token 'e', "error conn"... is not valid JSON
//       at JSON.parse (<anonymous>)
//       at prState (scripts/pr-follow.ts:244:44)
// The watcher died at develop-gates, seven minutes into a pipeline that takes
// twenty-five. Re-running it immediately reported DEPLOYED -- so the condition
// was transient and retrying was the correct response, which the tool denied
// itself by crashing.
//
// TWO DEFECTS COMBINED, both already documented elsewhere in this repo:
//
//   1. sh() returns `r.stdout + r.stderr`. Joining a diagnostic channel into a
//      data channel is what made eas-build-freshness-gate report
//      ACQUISITION_FAILED against a healthy account (eas-cli writes an upgrade
//      banner to stderr). The comment added there in the same session named
//      pr-follow.ts as carrying the identical latent trap "harmless only
//      because gh prints no stderr banner on success". It sprang the same day.
//
//   2. prState is the ONLY one of three JSON call sites in pr-follow.ts without
//      a guard: parseJsonAs and listChecks both wrap JSON.parse in try/catch.
//      The `raw || '{}'` fallback shows empty output was anticipated and
//      malformed output was not -- yet sh() guarantees malformed output the
//      moment gh writes anything to stderr.
//
// WHY NOT JUST CATCH IT. Returning `{ merged: false }` on a parse failure would
// make a network blip indistinguishable from an unmerged PR -- the watcher
// would silently report pr-merged as pending forever and TIMEOUT at 60m with a
// misleading phase. The fix separates DATA from DIAGNOSTICS at the boundary so
// a transient read is simply retried on the next poll, which is what the loop
// already does for every other unfinished phase.

import { describe, it, expect } from 'vitest';
import { parseGhJson } from './pr-follow.ts';

describe('parseGhJson: transient gh failures are retryable, not fatal', () => {
  it('parses a well-formed payload', () => {
    const r = parseGhJson('{"state":"MERGED"}');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') expect.unreachable('narrowing');
    expect(r.value).toEqual({ state: 'MERGED' });
  });

  it('reports unreadable -- never throws -- on a gh connection error', () => {
    const r = parseGhJson('error connecting to api.github.com');
    expect(
      r.kind,
      'this exact string killed the watcher seven minutes into a twenty-five ' +
        'minute pipeline; an unhandled SyntaxError is not an acceptable ' +
        'response to a dropped connection',
    ).toBe('unreadable');
  });

  it('reports unreadable on empty output rather than inventing a payload', () => {
    const r = parseGhJson('');
    expect(
      r.kind,
      'the old code substituted {} for empty output, which then parsed as a ' +
        'VALID but meaningless object -- indistinguishable from a real answer',
    ).toBe('unreadable');
  });

  it('reports unreadable on whitespace-only output', () => {
    expect(parseGhJson('   \n  ').kind).toBe('unreadable');
  });

  it('carries the raw text so the operator sees WHAT gh said', () => {
    const r = parseGhJson('error connecting to api.github.com');
    if (r.kind !== 'unreadable') expect.unreachable('narrowing');
    expect(
      r.raw,
      'discarding the message is how a root cause hides behind a generic ' +
        'retry line -- the same failure the classifyRollup arc removed',
    ).toContain('api.github.com');
  });

  it('truncates a pathologically long payload rather than flooding the log', () => {
    const r = parseGhJson('x'.repeat(5000));
    if (r.kind !== 'unreadable') expect.unreachable('narrowing');
    expect(r.raw.length).toBeLessThanOrEqual(300);
  });

  it('does not treat a JSON null as a usable payload', () => {
    expect(
      parseGhJson('null').kind,
      'null parses successfully but carries no state; treating it as ok would ' +
        'push an undefined-shaped value into the schema layer',
    ).toBe('unreadable');
  });
});
