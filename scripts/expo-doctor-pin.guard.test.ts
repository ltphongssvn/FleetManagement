// scripts/expo-doctor-pin.guard.test.ts
// LEVEL 8: prove that loosening the pin, or removing the supply-chain
// controls, turns this suite red.
//
// WHAT THIS CLOSES. The first revision of //#expo:doctor ran
// `npx --yes expo-doctor@latest`, and argued for it in a comment: a pinned
// copy would answer with stale rules about a newer SDK. That trade is
// backwards. @latest resolves at EXECUTION TIME to whatever the registry
// served moments earlier, so a typosquat, a maintainer takeover or an
// unreviewed breaking change executes inside a merge gate with no lockfile
// entry, no integrity hash and no review -- the shape that shipped 84
// malicious @tanstack versions in May 2026.
//
// It also bypassed controls this repo ALREADY OWNS: pnpm-workspace.yaml
// enforces a minimumReleaseAge cooldown and every install verifies the
// lockfile against supply-chain policy. Nothing npx downloads is in the
// lockfile, so neither applied.
//
// AND LOCKFILE INTEGRITY ALONE WOULD NOT HAVE SAVED US. When malicious
// axios@1.14.1 was published in March 2026, the registry computed and served
// the CORRECT SHA-512 for that tarball; a frozen-lockfile install verified it,
// reported success, and ran the RAT. A hash proves bytes are unchanged since
// publish, never that the publish was legitimate. trustPolicy: no-downgrade is
// the control that closes that gap, and pnpm is the only package manager
// offering it consumer-side.
//
// These assertions are the reason a future edit cannot quietly undo any of it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { EXPO_APPS, EXPO_DOCTOR_VERSION, doctorArgs } from './expo-doctor.js';

const ROOT = resolve(import.meta.dirname, '..');

interface Manifest {
  readonly devDependencies?: Readonly<Record<string, string>>;
}
interface Workspace {
  readonly trustPolicy?: string;
  readonly blockExoticSubdeps?: boolean;
  readonly trustPolicyExclude?: readonly string[];
}

function manifest(app: string): Manifest {
  return JSON.parse(readFileSync(resolve(ROOT, app, 'package.json'), 'utf8')) as Manifest;
}
function workspace(): Workspace {
  return parse(readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8')) as Workspace;
}
function lockfile(): string {
  return readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8');
}

describe('expo-doctor is pinned, not floating', () => {
  // THE FIX, asserted. A version specifier here would reintroduce a run-time
  // registry fetch of unreviewed content.
  it('the invocation carries NO version specifier', () => {
    for (const arg of doctorArgs()) {
      expect([arg, arg.includes('@')]).toEqual([arg, false]);
    }
  });

  it('never invokes a floating tag', () => {
    const flat = doctorArgs().join(' ');
    expect(flat).not.toContain('latest');
    expect(flat).not.toContain('next');
  });

  // EXACT, no caret or tilde: a range would let a patch resolve to something
  // never reviewed, which is the same hole in slower motion.
  it('every Expo app pins the EXACT version, with no range operator', () => {
    for (const app of EXPO_APPS) {
      const pinned = manifest(app).devDependencies?.['expo-doctor'];
      expect([app, pinned]).toEqual([app, EXPO_DOCTOR_VERSION]);
      expect([app, /^[0-9]/.test(pinned ?? '')]).toEqual([app, true]);
    }
  });

  // The constant and the manifests must agree, or the code documents one
  // version while another executes.
  it('the source constant is a plain semver', () => {
    expect(EXPO_DOCTOR_VERSION).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
  });

  // In the lockfile means: integrity-hashed, cooldown-vetted, trust-checked.
  it('is resolved in the LOCKFILE with an integrity hash', () => {
    const lock = lockfile();
    expect(lock).toContain('expo-doctor@' + EXPO_DOCTOR_VERSION);
    const entry = new RegExp(
      'expo-doctor@' +
        EXPO_DOCTOR_VERSION.replace(/[.]/g, '[.]') +
        ':[\\s\\S]{0,200}?integrity: sha512-',
    );
    expect(entry.test(lock)).toBe(true);
  });
});

describe('the workspace supply-chain controls stay on', () => {
  // The only consumer-side control that catches a provenance downgrade -- the
  // axios class, where the integrity hash matches and the package is hostile.
  it('trustPolicy is no-downgrade', () => {
    expect(workspace().trustPolicy).toBe('no-downgrade');
  });

  // Without it a transitive dep can pull code from an arbitrary git or tarball
  // URL, outside the cooldown, the integrity hash and the trust policy alike.
  it('blockExoticSubdeps is enabled', () => {
    expect(workspace().blockExoticSubdeps).toBe(true);
  });

  // The allowlist is the sanctioned response to a false positive; the
  // alternative pnpm offers, trustPolicyIgnoreAfter, silences EVERY package
  // older than its window and would hide a real takeover of a long-lived
  // package. Its absence is deliberate and asserted.
  it('uses a per-version allowlist, NOT a blanket time window', () => {
    const ws = workspace() as Workspace & { trustPolicyIgnoreAfter?: number };
    expect(ws.trustPolicyIgnoreAfter).toBeUndefined();
    expect((ws.trustPolicyExclude ?? []).length).toBeGreaterThan(0);
  });

  // Every entry must be an EXACT package@version. A bare package name would
  // exempt that package forever, including versions nobody has reviewed.
  it('every allowlist entry names an exact version', () => {
    for (const entry of workspace().trustPolicyExclude ?? []) {
      expect([entry, /^@?[^@]+@[0-9]+[.][0-9]+[.][0-9]+$/.test(entry)]).toEqual([entry, true]);
    }
  });
});
