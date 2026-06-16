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
  parseReleaseDecision,
  backMergeSubject,
  releaseDecisionIsAuthoritative,
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
    expect(releaseCloseoutConfigSchema.safeParse({ ...base, developBranch: '' }).success).toBe(false);
  });
});

describe('parseReleaseDecision', () => {
  it('detects a PUBLISHED release and extracts the version from semantic-release log', () => {
    const log = [
      '[semantic-release] [@semantic-release/commit-analyzer] Analysis of 8 commits complete: minor release',
      '[semantic-release] Published release 1.7.0 on default channel',
    ].join('\n');
    const d = parseReleaseDecision(log);
    expect(d.released).toBe(true);
    expect(d.version).toBe('1.7.0');
  });
  it('detects NO release (chore-only) from the real "no relevant changes" line', () => {
    const log = [
      '[semantic-release] [@semantic-release/commit-analyzer] Analysis of 6 commits complete: no release',
      '[semantic-release] There are no relevant changes, so no new version is released.',
    ].join('\n');
    const d = parseReleaseDecision(log);
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });
  it('treats an unparseable/ambiguous log as not-released (fail-safe, no fabricated version)', () => {
    const d = parseReleaseDecision('some unrelated output');
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });

  it('does NOT treat the semantic-release TOOL version as a release (real bug: v25.0.3)', () => {
    const log = [
      '[semantic-release] ℹ  Running semantic-release version 25.0.3',
      '[semantic-release] ℹ  Loaded plugin "verifyConditions" from "@semantic-release/github"',
    ].join('\n');
    const d = parseReleaseDecision(log);
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });

  it('parses the dry-run branch-guard line (triggered on develop, publishes only from main) as not-released', () => {
    const log = '[semantic-release] ℹ  This test run was triggered on the branch develop, while semantic-release is configured to only publish from main, therefore a new version won’t be published.';
    const d = parseReleaseDecision(log);
    expect(d.released).toBe(false);
    expect(d.version).toBeNull();
  });

  it('still extracts a real published version even when the tool-version line is also present', () => {
    const log = [
      '[semantic-release] ℹ  Running semantic-release version 25.0.3',
      '[semantic-release] ℹ  The next release version is 1.7.0',
      '[semantic-release] ✔  Published release 1.7.0 on default channel',
    ].join('\n');
    const d = parseReleaseDecision(log);
    expect(d.released).toBe(true);
    expect(d.version).toBe('1.7.0');
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

describe('releaseDecisionIsAuthoritative', () => {
  it('is FALSE when semantic-release ran on a non-publish branch (verdict not trustworthy)', () => {
    const log = '[semantic-release] This test run was triggered on the branch develop, while semantic-release is configured to only publish from main, therefore a new version won\u2019t be published.';
    expect(releaseDecisionIsAuthoritative(log, 'main')).toBe(false);
  });
  it('is TRUE when the run is on the configured publish branch', () => {
    const log = '[semantic-release] Running on branch main\n[semantic-release] There are no relevant changes, so no new version is released.';
    expect(releaseDecisionIsAuthoritative(log, 'main')).toBe(true);
  });
});
