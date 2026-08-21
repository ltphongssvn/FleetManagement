// scripts/bump-expo.test.ts
// The rules that decide what an Expo SDK alignment changes.
//
// THE MANIFEST FIXTURE IS REAL: the specs below are driver-app's actual
// declarations on develop at 2026-08-20, and the drift rows are what
// expo-doctor printed against them. A planner tested against invented input
// proves only that it matches the invention.
import { describe, it, expect } from 'vitest';
import {
  EXPO_BUMP_EXIT,
  applyManifestVersions,
  planExpoBump,
} from './bump-expo.js';
import type { DriftedPackage } from './expo-doctor.js';

const MANIFEST = JSON.stringify(
  {
    name: '@fleet/driver-app',
    dependencies: {
      expo: '^55.0.26',
      'expo-router': '~55.0.16',
      '@expo/metro-runtime': '^55.0.11',
      'react-native': '0.83.6',
      zod: 'catalog:',
    },
    devDependencies: {
      'expo-doctor': '1.18.24',
    },
  },
  null,
  2,
);

const row = (name: string, expected: string, found: string): DriftedPackage =>
  ({ name, expected, found });

const DRIFT: readonly DriftedPackage[] = [
  row('expo', '~55.0.29', '55.0.26'),
  row('expo-router', '~55.0.18', '55.0.16'),
  row('@expo/metro-runtime', '~55.0.12', '55.0.11'),
  row('react-native', '0.83.10', '0.83.6'),
];

describe('planExpoBump only touches DECLARED packages', () => {
  it('plans every package the manifest declares', () => {
    expect(planExpoBump(MANIFEST, DRIFT).map((r) => r.name).sort())
      .toEqual(['@expo/metro-runtime', 'expo', 'expo-router', 'react-native']);
  });

  // expo-doctor also reports drift for TRANSITIVE packages no manifest owns.
  // Writing those in would create a phantom direct dependency -- a dependency
  // the app does not use, pinned by a tool, forever.
  it('SKIPS a drifted package the manifest does not declare', () => {
    const withGhost = [...DRIFT, row('expo-font', '~55.0.9', '55.0.7')];
    expect(planExpoBump(MANIFEST, withGhost).some((r) => r.name === 'expo-font')).toBe(false);
  });

  it('plans nothing when nothing drifted', () => {
    expect(planExpoBump(MANIFEST, [])).toEqual([]);
  });

  // A substring must not match: 'expo' is a prefix of 'expo-router', so a
  // careless contains() would plan the wrong entry.
  it('matches a package as a declared KEY, not as a substring', () => {
    const onlyRouter = planExpoBump(MANIFEST, [row('expo-rout', '~1.0.0', '0.9.0')]);
    expect(onlyRouter).toEqual([]);
  });
});

describe('applyManifestVersions writes what Expo expects', () => {
  const out = applyManifestVersions(MANIFEST, DRIFT);

  it('produces parseable JSON', () => {
    expect(() => {
      JSON.parse(out);
    }).not.toThrow();
  });

  it('applies the expected spec verbatim, range operator included', () => {
    const deps = (JSON.parse(out) as { dependencies: Record<string, string> }).dependencies;
    expect(deps['expo']).toBe('~55.0.29');
  });

  // react-native is pinned EXACT by Expo; the operator must not be invented.
  it('preserves an EXACT pin with no range operator', () => {
    const deps = (JSON.parse(out) as { dependencies: Record<string, string> }).dependencies;
    expect(deps['react-native']).toBe('0.83.10');
  });

  it('rewrites a SCOPED package', () => {
    const deps = (JSON.parse(out) as { dependencies: Record<string, string> }).dependencies;
    expect(deps['@expo/metro-runtime']).toBe('~55.0.12');
  });

  // Everything not planned must be byte-identical -- especially catalog:,
  // which a naive semver rewrite would destroy.
  it('leaves undrifted entries untouched, including catalog:', () => {
    const parsed = JSON.parse(out) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(parsed.dependencies['zod']).toBe('catalog:');
    expect(parsed.devDependencies['expo-doctor']).toBe('1.18.24');
  });

  it('changes nothing when the plan is empty', () => {
    expect(applyManifestVersions(MANIFEST, [])).toBe(MANIFEST);
  });

  // IDEMPOTENCE: a second run over already-aligned text is a no-op, so
  // re-running is verifiable rather than a silent rewrite.
  it('is idempotent', () => {
    expect(applyManifestVersions(out, DRIFT)).toBe(out);
  });
});

describe('applyManifestVersions refuses rather than guessing', () => {
  // Zero occurrences means the plan disagrees with the file it was built from.
  it('THROWS when the package is absent', () => {
    expect(() => applyManifestVersions(MANIFEST, [row('expo-camera', '~55.0.1', '55.0.0')]))
      .toThrow(/exactly one declaration/);
  });

  // Two occurrences means dependencies AND devDependencies both declare it,
  // and a blind replace would rewrite whichever came first.
  it('THROWS when the package is declared TWICE', () => {
    // Indented, like every real manifest on disk: the needle matches a
    // declared key with its standard '": "' separator, so a minified fixture
    // would match zero times and prove nothing about the double-declaration
    // case this test exists for.
    const doubled = JSON.stringify({
      dependencies: { 'expo-sqlite': '~55.0.16' },
      devDependencies: { 'expo-sqlite': '~55.0.16' },
    }, null, 2);
    expect(() => applyManifestVersions(doubled, [row('expo-sqlite', '~55.0.19', '55.0.16')]))
      .toThrow(/found 2/);
  });

  // A refusal must leave the input untouched: no partial write.
  it('does not mutate its input when it throws', () => {
    const before = MANIFEST;
    try {
      applyManifestVersions(MANIFEST, [row('nope', '~1.0.0', '0.9.0')]);
    } catch {
      // expected
    }
    expect(MANIFEST).toBe(before);
  });
});

describe('the exit codes let a caller branch', () => {
  it('keeps every code distinct', () => {
    const codes = Object.values(EXPO_BUMP_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // nothing-to-do is NOT ok: a caller scheduling this op needs to tell "I
  // aligned things" from "there was nothing to align".
  it('distinguishes nothing-to-do from ok', () => {
    expect(EXPO_BUMP_EXIT.nothingToDo).not.toBe(EXPO_BUMP_EXIT.ok);
  });
});
