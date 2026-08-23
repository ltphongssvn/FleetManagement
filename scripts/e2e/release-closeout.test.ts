// scripts/e2e/release-closeout.test.ts
// Outside-in RED: contract for the GitFlow release closeout BEFORE it exists.
// SSOT = releaseCloseoutConfigSchema. Pure functions parse semantic-release's
// ACTUAL decision (two real states observed: published "vX.Y.Z" OR "no relevant
// changes, so no new version is released") and derive the correct back-merge
// commit subject for each — fixing the bug where the subject referenced a tag
// from `git tag` guesswork instead of the real release outcome. Imports a module
// that does not exist yet -> MUST fail at import.
import { describe, it, expect } from 'vitest';
import {
  releaseCloseoutConfigSchema,
  backMergeSubject,
  resolveReleaseFromTags,
} from './release-closeout.ts';

const base = {
  baseBranch: 'main',
  developBranch: 'develop',
  prNumber: 87,
};

describe('releaseCloseoutConfigSchema', () => {
  it('accepts a valid config', () => {
    const c = releaseCloseoutConfigSchema.parse(base);
    expect(c.baseBranch).toBe('main');
    expect(c.prNumber).toBe(87);
  });
  it('rejects a non-positive PR number', () => {
    expect(releaseCloseoutConfigSchema.safeParse({ ...base, prNumber: 0 }).success).toBe(false);
  });
  it('rejects an empty develop branch', () => {
    expect(releaseCloseoutConfigSchema.safeParse({ ...base, developBranch: '' }).success).toBe(
      false,
    );
  });
});

describe('backMergeSubject', () => {
  it('references the published version when a release occurred', () => {
    const s = backMergeSubject({ released: true, version: '1.7.0' }, base.prNumber);
    expect(s).toContain('v1.7.0');
    expect(s).toContain('#87');
    expect(s.toLowerCase()).not.toContain('no release');
  });
  it('states no-release explicitly (no tag reference) when nothing published', () => {
    const s = backMergeSubject({ released: false, version: null }, base.prNumber);
    expect(s).toContain('#87');
    expect(s.toLowerCase()).toContain('no release');
    expect(s).not.toMatch(/v\d+\.\d+\.\d+/);
  });
});

describe('resolveReleaseFromTags', () => {
  // Closeout runs LOCALLY, AFTER the Release workflow tagged main. A fresh dry-run
  // is blind (0 new commits => "no release") AND needs a GH token (ENOGHTOKEN). The
  // authoritative published version is the tag at main HEAD not yet on develop.
  it('reports the release when a tag at main HEAD is not yet on develop (the #92 reality)', () => {
    const d = resolveReleaseFromTags(['v1.6.1'], ['v1.6.0', 'v1.5.0']);
    expect(d.released).toBe(true);
    expect(d.version).toBe('1.6.1');
  });
  it('reports NO release when no tag points at main HEAD (chore-only promote)', () => {
    const d = resolveReleaseFromTags([], ['v1.6.0', 'v1.5.0']);
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });
  it('is idempotent: a main-HEAD tag already on develop is not re-reported (back-merge already done)', () => {
    const d = resolveReleaseFromTags(['v1.6.1'], ['v1.6.1', 'v1.6.0']);
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });
  it('strips the leading v so the version matches the semantic-release shape', () => {
    expect(resolveReleaseFromTags(['v2.0.0'], []).version).toBe('2.0.0');
  });
  it('picks the highest semver when multiple new tags point at main HEAD', () => {
    const d = resolveReleaseFromTags(['v1.6.1', 'v1.7.0'], ['v1.6.0']);
    expect(d.released).toBe(true);
    expect(d.version).toBe('1.7.0');
  });
});
