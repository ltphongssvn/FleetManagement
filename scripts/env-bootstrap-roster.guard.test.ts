// scripts/env-bootstrap-roster.guard.test.ts
// ARCHITECTURAL GUARD: .sops.yaml must never disagree with .age-recipients,
// and the roster must never LABEL a machine it does not GRANT.
//
// WHY. .age-recipients warns in its own header that a recipient list which
// disagrees with the ciphertext locks somebody out SILENTLY, and .sops.yaml is
// GENERATED -- so the only thing standing between the two files was an operator
// remembering to run env:recipients. Every other test in this arc proves
// renderSopsConfig is CORRECT. None proved it was APPLIED. That gap is the same
// shape as terminal-registry.ts: correct code nobody invoked.
//
// The failure is not hypothetical, and it RECURRED. On 2026-08-11 a fourth
// machine joined the estate while one key was listed, two machines marked
// not-yet-added in a status column. The revision that added these guards
// replaced the column with a plain roll-call and read as an estate of four
// beside two keys -- the same drift in a new costume.
//
// PARSE STRUCTURE, NOT PROSE. The first attempt at closing this scanned comment
// lines for anything hostname-shaped, and immediately mistook the numbered
// ADD A MACHINE steps for machines. Guessing which sentences are data is the
// anti-pattern that metadata conventions exist to remove: structured data needs
// a delimiter, not a heuristic. The delimiter here is ADJACENCY -- a flush
// "# Host (detail)" line labels the key on the line below it -- so the checks
// below read that relationship in BOTH directions and never interpret prose.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGE_PREFIX,
  RECIPIENTS_FILE,
  SOPS_CONFIG_FILE,
  parseRecipientEntries,
  parseRecipients,
  renderSopsConfig,
  rosterHosts,
} from './env-bootstrap.js';

const ROOT = join(import.meta.dirname, '..');
const NL = String.fromCharCode(10);
const HASH = String.fromCharCode(35);

/** The age public-key shape, matched ANYWHERE in a line. Distinct from the
 *  anchored check in the core: this one harvests keys out of rendered YAML,
 *  where each key sits indented inside a folded scalar rather than at column
 *  zero. */
const AGE_RECIPIENT_ANYWHERE = /age1[02-9ac-hj-np-z]{58}/g;

/** A HOST LABEL, structurally: a flush comment marker, one unspaced name, then
 *  a parenthesised description. That is the shape every entry uses and nothing
 *  else in the file does -- documentation lines are indented, and prose has
 *  spaces before any bracket. Recognising the convention is not the same as
 *  guessing at meaning: a line either has this shape or it does not. */
const HOST_LABEL_RE = /^#\s[^\s(]+\s\(/;

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
    const lines = read(RECIPIENTS_FILE).split(NL);
    lines.forEach((line, i) => {
      if (!line.trim().startsWith(AGE_PREFIX)) return;
      const above = (lines[i - 1] ?? '').trim();
      expect(above.startsWith(HASH)).toBe(true);
    });
  });
});

describe('the estate is derived from the grants, never declared beside them', () => {
  it('pairs every key with the host named above it', () => {
    const entries = parseRecipientEntries(read(RECIPIENTS_FILE));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.host).not.toBe('');
      expect(entry.key.startsWith(AGE_PREFIX)).toBe(true);
    }
  });

  it('derives exactly as many hosts as there are keys', () => {
    const content = read(RECIPIENTS_FILE);
    expect(rosterHosts(content)).toHaveLength(parseRecipients(content).length);
  });

  it('names no host twice, since one machine holds one identity', () => {
    const hosts = rosterHosts(read(RECIPIENTS_FILE));
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  // THE DEFECT THIS CLOSES, as the CONVERSE of the adjacency asserted above.
  // Every key must carry a label; equally, every label must carry a key. A
  // label with no key below it is a machine the file presents as part of the
  // estate while it cannot decrypt -- which is precisely what a roll-call list
  // becomes the moment a key is not added alongside it.
  it('labels no machine it does not grant', () => {
    const lines = read(RECIPIENTS_FILE).split(NL);
    lines.forEach((line, i) => {
      if (!HOST_LABEL_RE.test(line)) return;
      const below = (lines[i + 1] ?? '').trim();
      expect(below.startsWith(AGE_PREFIX)).toBe(true);
    });
  });

  it('strips parenthetical detail so the host reads as a bare name', () => {
    const entries = parseRecipientEntries(
      HASH + ' Host-One (Apple Silicon, macOS 15.7)' + NL +
      'age1022fpw0nt5xdw5txz86cl5whgeq2u3cxhtx9anuvz0twawyh84lqwl0etj',
    );
    expect(entries[0]?.host).toBe('Host-One');
  });

  it('reports an empty host when a key has no comment above it', () => {
    const entries = parseRecipientEntries(
      'age1022fpw0nt5xdw5txz86cl5whgeq2u3cxhtx9anuvz0twawyh84lqwl0etj',
    );
    expect(entries[0]?.host).toBe('');
  });
});
