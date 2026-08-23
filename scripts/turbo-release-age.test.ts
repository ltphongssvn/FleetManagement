// scripts/turbo-release-age.test.ts
// The rules //#bump:turbo will now enforce, asserted where they are cheap.
//
// WHY THESE AND NOT A FILE TEST. The seven exclude lines were missed because
// nothing could ask the question "does the pin agree with the exclude list";
// the pin guard reads package.json alone. These pin the pure rules -- rendering,
// parsing, idempotence, and the missing-entry query -- so the guard that reads
// the real file (turbo-release-age.guard.test.ts) asserts one fact against
// logic already proven here.
import { describe, it, expect } from 'vitest';
import {
  TURBO_PLATFORM_PACKAGES,
  excludeLineFor,
  missingTurboExcludes,
  turboExcludeLines,
  versionsInExcludeLine,
  withTurboVersion,
} from './turbo-release-age.js';

describe('TURBO_PLATFORM_PACKAGES', () => {
  // The omission that shipped was invisible because it fails on ONE host. A
  // list missing a platform reproduces exactly that.
  it('covers every platform pnpm may resolve, plus the runner', () => {
    expect([...TURBO_PLATFORM_PACKAGES].sort()).toEqual([
      '@turbo/darwin-64',
      '@turbo/darwin-arm64',
      '@turbo/linux-64',
      '@turbo/linux-arm64',
      '@turbo/windows-64',
      '@turbo/windows-arm64',
      'turbo',
    ]);
  });

  it('is frozen, so a caller cannot mutate the vocabulary at runtime', () => {
    expect(Object.isFrozen(TURBO_PLATFORM_PACKAGES)).toBe(true);
  });
});

describe('excludeLineFor: YAML quoting is derived from the name', () => {
  // A leading @ starts an alias node in YAML, so an unquoted scoped name is a
  // parse error -- pnpm-workspace.yaml would stop loading entirely.
  it('quotes a scoped package', () => {
    expect(excludeLineFor('@turbo/darwin-arm64', ['2.10.10'])).toBe(
      "'@turbo/darwin-arm64@2.10.10'",
    );
  });

  // Matching the committed file exactly matters: rendering the bare name with
  // quotes would rewrite a line that did not change, on every single bump.
  it('leaves an unscoped package unquoted, as the committed file has it', () => {
    expect(excludeLineFor('turbo', ['2.10.10'])).toBe('turbo@2.10.10');
  });

  it('joins several versions with the pnpm range separator', () => {
    expect(excludeLineFor('turbo', ['2.10.9', '2.10.10'])).toBe('turbo@2.10.9 || 2.10.10');
  });

  it('renders one line per package', () => {
    expect(turboExcludeLines(['2.10.10'])).toHaveLength(TURBO_PLATFORM_PACKAGES.length);
  });
});

describe('versionsInExcludeLine: reads a human-edited file', () => {
  it('reads a bare entry', () => {
    expect(versionsInExcludeLine('turbo@2.10.9 || 2.10.10')).toEqual(['2.10.9', '2.10.10']);
  });

  it('reads a quoted scoped entry', () => {
    expect(versionsInExcludeLine("'@turbo/linux-64@2.10.8 || 2.10.9'")).toEqual([
      '2.10.8',
      '2.10.9',
    ]);
  });

  // The file stores these as YAML sequence items, so the reader must tolerate
  // the leading dash and arbitrary indentation.
  it('reads a line still carrying its YAML sequence dash', () => {
    expect(versionsInExcludeLine('  - turbo@2.10.10')).toEqual(['2.10.10']);
  });

  // lastIndexOf('@'), not indexOf: a scoped name contains an @ of its own, and
  // splitting on the first one would yield 'turbo/linux-64@2.10.9' as a version.
  it('splits on the LAST @, so a scoped name is not mistaken for a version', () => {
    expect(versionsInExcludeLine("'@turbo/windows-arm64@2.10.10'")).toEqual(['2.10.10']);
  });

  it('returns nothing for a line carrying no version', () => {
    expect(versionsInExcludeLine('turbo')).toEqual([]);
  });
});

describe('withTurboVersion: appending is idempotent', () => {
  it('appends a version the list does not carry', () => {
    expect(withTurboVersion(['2.10.9'], '2.10.10')).toEqual(['2.10.9', '2.10.10']);
  });

  // A bump re-run at the same version must leave the file byte-identical, or
  // bump-turbo.ts dirties the tree and its own dirty-tree refusal starts
  // rejecting legitimate runs.
  it('is a NO-OP when the version is already present', () => {
    const before = ['2.10.9', '2.10.10'];
    expect(withTurboVersion(before, '2.10.10')).toEqual(before);
  });

  // Chronological order is the file's convention; re-sorting would rewrite six
  // untouched lines on every bump and bury the real change in the diff.
  it('appends rather than sorting, keeping the file chronological', () => {
    expect(withTurboVersion(['2.10.3', '2.10.2'], '2.10.10')).toEqual([
      '2.10.3',
      '2.10.2',
      '2.10.10',
    ]);
  });
});

describe('missingTurboExcludes: the question nothing could ask', () => {
  const complete = turboExcludeLines(['2.10.9', '2.10.10']);

  it('reports nothing when every package carries the version', () => {
    expect(missingTurboExcludes(complete, '2.10.10')).toEqual([]);
  });

  // THE OBSERVED FAILURE, as an assertion: PR #602 raised the pin and left
  // every exclude line at 2.10.9.
  it('reports EVERY package when the bump forgot the exclude list', () => {
    const stale = turboExcludeLines(['2.10.9']);
    expect([...missingTurboExcludes(stale, '2.10.10')].sort()).toEqual(
      [...TURBO_PLATFORM_PACKAGES].sort(),
    );
  });

  // NAMES the platform rather than returning a boolean: "the exclude list is
  // wrong" is not actionable, "darwin-arm64 is unexempted" is.
  it('names the ONE platform a partial edit missed', () => {
    const partial = complete.filter((l) => !l.includes('@turbo/darwin-arm64@'));
    expect(missingTurboExcludes(partial, '2.10.10')).toEqual(['@turbo/darwin-arm64']);
  });

  it('treats an ABSENT line as missing, not as satisfied', () => {
    expect(missingTurboExcludes([], '2.10.10')).toHaveLength(TURBO_PLATFORM_PACKAGES.length);
  });

  // A line for the right package at the WRONG version is the subtle case: it
  // looks present to any check that only greps for the package name.
  it('treats a present line at an OLDER version as missing', () => {
    expect(missingTurboExcludes(turboExcludeLines(['2.10.9']), '2.10.10')).toContain('turbo');
  });
});
