// apps/api/test/attestation-platform-ssot.guard.test.ts
// Guard: the attestation platform vocabulary is declared ONCE.
//
// platform.ts is the SSOT and already does the derivation correctly:
//   PlatformSchema           = z.enum(['ios','android','web'])
//   AttestationPlatformSchema = PlatformSchema.exclude(['web'])
// attestation.controller.ts consumes both -- it parses with the schema and
// types its AttestationRepository port with AttestationPlatform.
//
// THE VIOLATION. Two files downstream re-declare the same union by hand:
//   attestation.repository.ts:16  platform: 'android' | 'ios'
//   attestation.service.ts:43     readonly platform: 'android' | 'ios'
// The repository one is the sharper case: the class IMPLEMENTS the very
// interface that types this parameter as AttestationPlatform, so one method
// signature is declared twice -- once derived, once hand-written -- and
// TypeScript accepts both only because the values coincide TODAY. Add a
// platform to PlatformSchema and the port widens while the implementation
// silently does not.
//
// A guard rather than a behavioural test: nothing about runtime changes, and
// the property worth protecting is that the literals never reappear. Its
// sibling fields already derive from sync-protocol SSOT enums (see the
// repository file header) -- platform was the outlier.
//
// NOT included: attestation-trust-store.ts AttestationRootPlatform. Same values,
// DIFFERENT concept -- "platforms for which we have pinned a root CA", keying
// TRUSTED_ROOT_HASHES. Coupling certificate pinning to the enrollment enum would
// be over-abstraction; identical values do not imply one shape (two-axis rule).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEVICE_DIR = join(import.meta.dirname, '..', 'src', 'device');

function source(file: string): string {
  return readFileSync(join(DEVICE_DIR, file), 'utf-8');
}

// Comments legitimately mention the old literal while explaining the change, so
// the guard reads CODE only -- the comment-substring false-positive class this
// repo has hit repeatedly.
function codeOnly(s: string): string {
  return s
    .split(String.fromCharCode(10))
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join(String.fromCharCode(10));
}

const HAND_WRITTEN = /'android'\s*\|\s*'ios'|'ios'\s*\|\s*'android'/;

describe('attestation platform vocabulary is declared once', () => {
  it('the SSOT derives the attestation subset from the base enum', () => {
    const ssot = source('platform.ts');
    expect(ssot).toContain('AttestationPlatformSchema');
    expect(ssot).toContain("PlatformSchema.exclude(['web'])");
  });

  it('the repository does not re-declare the union it inherits', () => {
    expect(HAND_WRITTEN.test(codeOnly(source('attestation.repository.ts')))).toBe(false);
  });

  it('the service does not re-declare the union', () => {
    expect(HAND_WRITTEN.test(codeOnly(source('attestation.service.ts')))).toBe(false);
  });

  it('both import the SSOT type instead', () => {
    for (const f of ['attestation.repository.ts', 'attestation.service.ts']) {
      expect(source(f)).toContain('AttestationPlatform');
    }
  });

  // The trust store is deliberately exempt: same values, different concept.
  it('leaves the trust-store root vocabulary alone', () => {
    expect(source('attestation-trust-store.ts')).toContain('AttestationRootPlatform');
  });
});
