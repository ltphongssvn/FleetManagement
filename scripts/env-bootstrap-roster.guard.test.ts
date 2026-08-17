// scripts/env-bootstrap-roster.guard.test.ts
// ARCHITECTURAL GUARD: .sops.yaml must never disagree with .age-recipients.
//
// WHY. .age-recipients warns in its own header that a recipient list which
// disagrees with the ciphertext locks somebody out SILENTLY, and .sops.yaml is
// GENERATED -- so the only thing standing between the two files was an operator
// remembering to run env:recipients. Every other test in this arc proves
// renderSopsConfig is CORRECT. None proved it was APPLIED. That gap is the same
// shape as terminal-registry.ts: correct code nobody invoked.
//
// The failure is not hypothetical. On 2026-08-11 a fourth machine joined the
// estate and the roster still held one key, with two machines named in a
// comment as not-yet-added -- prose doing the job of an assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECIPIENTS_FILE,
  SOPS_CONFIG_FILE,
  parseRecipients,
  renderSopsConfig,
} from './env-bootstrap.js';

const ROOT = join(import.meta.dirname, '..');

/** The age public-key shape, matched ANYWHERE in a line. Distinct from the
 *  anchored check below: this one harvests keys out of rendered YAML, where
 *  each key sits indented inside a folded scalar rather than at column zero. */
const AGE_RECIPIENT_ANYWHERE = /age1[02-9ac-hj-np-z]{58}/g;

/** Prefix identifying a roster line as a key rather than a comment or blank.
 *  A literal prefix, not an anchored regex: eslint's
 *  prefer-string-starts-ends-with rejects /^.../.test(), and startsWith says
 *  what is meant without the reader parsing a pattern for anchors. */
const AGE_PREFIX = 'age1';

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf-8');
}

describe('.sops.yaml cannot drift from the recipient roster', () => {
  it('is byte-identical to a fresh render of the roster', () => {
    const roster = parseRecipients(read(RECIPIENTS_FILE));
    expect(read(SOPS_CONFIG_FILE)).toBe(renderSopsConfig(roster));
  });

  it('carries every roster entry -- no machine silently dropped', () => {
    const config = read(SOPS_CONFIG_FILE);
    for (const key of parseRecipients(read(RECIPIENTS_FILE))) {
      expect(config).toContain(key);
    }
  });

  it('adds no recipient the roster does not name', () => {
    const roster = parseRecipients(read(RECIPIENTS_FILE));
    const inConfig = read(SOPS_CONFIG_FILE).match(AGE_RECIPIENT_ANYWHERE) ?? [];
    expect([...inConfig].sort()).toEqual([...roster].sort());
  });
});

describe('the roster itself stays safe and legible', () => {
  it('carries no private identity material', () => {
    expect(read(RECIPIENTS_FILE)).not.toContain('AGE-SECRET-KEY');
  });

  it('names the host behind every key, so revocation knows what it revokes', () => {
    const lines = read(RECIPIENTS_FILE).split(String.fromCharCode(10));
    lines.forEach((line, i) => {
      if (!line.trim().startsWith(AGE_PREFIX)) return;
      const above = (lines[i - 1] ?? '').trim();
      expect(above.startsWith('#')).toBe(true);
    });
  });
});
