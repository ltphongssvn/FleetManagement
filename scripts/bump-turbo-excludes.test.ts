// scripts/bump-turbo-excludes.test.ts
// The half of //#bump:turbo that used to live in a human's memory.
//
// rewriteExcludeBlock is the new side of the bump: it edits the seven
// minimumReleaseAgeExclude entries in pnpm-workspace.yaml so the install that
// follows resolves against a policy that permits the version being pinned. It
// is PURE over the file text precisely so this suite can exercise it without a
// filesystem -- the property whose absence let PR #602 ship a pin its own
// policy had not exempted.
//
// The file it edits is hand-written and comment-heavy, so these tests pin the
// preservation properties as hard as the rewrite itself: comments survive,
// unrelated entries survive, indentation survives, and a re-run changes nothing.
import { describe, it, expect } from 'vitest';
import { rewriteExcludeBlock } from './bump-turbo.js';
import {
  TURBO_PLATFORM_PACKAGES,
  missingTurboExcludes,
  turboExcludeLines,
} from './turbo-release-age.js';

const NL = String.fromCharCode(10);

/** A miniature of the real block: a comment, two unrelated entries, and the
 *  seven turbo lines at an older version. */
function workspaceAt(version: string): string {
  return [
    'minimumReleaseAgeExclude:',
    '  # GHSA-xxxx: unrelated entry with a rationale that must survive.',
    '  - tmp@0.2.6 || 0.2.7',
    ...turboExcludeLines([version]).map((l) => '  - ' + l),
    '  - sharp@0.35.0',
  ].join(NL);
}

describe('rewriteExcludeBlock: every turbo package gains the new version', () => {
  const before = workspaceAt('2.10.9');
  const after = rewriteExcludeBlock(before, '2.10.10');

  // THE OBSERVED FAILURE, inverted into an assertion: PR #602 left all seven
  // lines at the old version.
  it('leaves NO turbo package unexempted at the new version', () => {
    expect(missingTurboExcludes(after.split(NL), '2.10.10')).toEqual([]);
  });

  it('KEEPS the old version, so a rollback still installs', () => {
    expect(after).toContain('turbo@2.10.9 || 2.10.10');
  });

  it('quotes the scoped packages, so the YAML still parses', () => {
    expect(after).toContain("'@turbo/darwin-arm64@2.10.9 || 2.10.10'");
  });

  it('edits every one of the seven, not just the runner', () => {
    for (const pkg of TURBO_PLATFORM_PACKAGES) {
      expect([pkg, after.includes(pkg + '@2.10.9 || 2.10.10')]).toEqual([pkg, true]);
    }
  });
});

describe('rewriteExcludeBlock: the file it edits is hand-written', () => {
  const after = rewriteExcludeBlock(workspaceAt('2.10.9'), '2.10.10');

  // The real block interleaves multi-paragraph advisory rationales with
  // entries. Regenerating it wholesale would delete them, which is why the
  // rewrite edits lines in place.
  it('PRESERVES comments', () => {
    expect(after).toContain('# GHSA-xxxx: unrelated entry with a rationale that must survive.');
  });

  it('PRESERVES unrelated entries above and below', () => {
    expect(after).toContain('- tmp@0.2.6 || 0.2.7');
    expect(after).toContain('- sharp@0.35.0');
  });

  // A changed indent silently moves an entry out of the YAML sequence, so the
  // indentation is taken from the line being replaced rather than hardcoded.
  it('PRESERVES indentation, so entries stay inside the sequence', () => {
    for (const line of after.split(NL).filter((l) => l.includes('turbo@'))) {
      expect([line, line.startsWith('  - ')]).toEqual([line, true]);
    }
  });

  it('adds no lines when every package already has one', () => {
    const before = workspaceAt('2.10.9');
    expect(rewriteExcludeBlock(before, '2.10.10').split(NL)).toHaveLength(before.split(NL).length);
  });
});

describe('rewriteExcludeBlock: idempotence', () => {
  // A re-run at the same version must leave the file byte-identical, or the
  // bump dirties the tree and its own dirty-tree refusal starts rejecting
  // legitimate runs.
  it('is a NO-OP when the version is already present', () => {
    const already = workspaceAt('2.10.10');
    expect(rewriteExcludeBlock(already, '2.10.10')).toBe(already);
  });

  it('is stable under a second application', () => {
    const once = rewriteExcludeBlock(workspaceAt('2.10.9'), '2.10.10');
    expect(rewriteExcludeBlock(once, '2.10.10')).toBe(once);
  });
});

describe('rewriteExcludeBlock: a package with no line at all', () => {
  // A new platform binary, or a hand-deleted line. Appending is correct;
  // silently skipping would reproduce the original defect for that platform.
  it('APPENDS an entry for a package the block does not mention', () => {
    const partial = workspaceAt('2.10.9')
      .split(NL)
      .filter((l) => !l.includes('@turbo/windows-arm64@'))
      .join(NL);
    const after = rewriteExcludeBlock(partial, '2.10.10');
    expect(missingTurboExcludes(after.split(NL), '2.10.10')).toEqual([]);
    expect(after).toContain("'@turbo/windows-arm64@2.10.10'");
  });

  // No anchor means no block: rewriting anything would be a guess about where
  // the sequence lives.
  it('leaves text carrying no turbo entry untouched', () => {
    const unrelated = 'minimumReleaseAgeExclude:' + NL + '  - sharp@0.35.0';
    expect(rewriteExcludeBlock(unrelated, '2.10.10')).toBe(unrelated);
  });
});
