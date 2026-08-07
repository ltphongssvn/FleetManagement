// scripts/git-merge-drivers.test.ts
// RED spec for the generated-file merge driver.
//
// ROOT CAUSE THIS ADDRESSES: .secrets.baseline is GENERATED. detect-secrets
// rewrites generated_at on every refresh and shifts line_number whenever any
// scanned file gains a line, so two branches that both touched it conflict on
// content that carries no meaning. It conflicted twice in a single session on
// nothing but the timestamp, and commit c074d43 shows another terminal burning
// a commit on the same churn. Hand-resolving a generated file is a treadmill.
//
// git supports exactly this: a custom merge driver declared in .gitattributes
// and registered in git config. keep-theirs resolves to the incoming side
// (cp %B %A), which for this file is correct -- develop is the integration
// truth, and the pre-commit hook plus the secrets:baseline task regenerate line
// numbers locally straight afterwards.
//
// The driver body must NEVER be applied to hand-written source: silently
// discarding one side of a real conflict is far worse than resolving it. The
// allowlist below is therefore explicit and asserted.
import { describe, it, expect } from 'vitest';
import {
  DRIVER_NAME,
  GENERATED_FILES,
  gitattributesContent,
  driverConfigEntries,
  gitConfigArgs,
  isRegistered,
} from './git-merge-drivers.js';

describe('GENERATED_FILES', () => {
  it('covers the baseline that actually conflicts', () => {
    expect(GENERATED_FILES).toContain('.secrets.baseline');
  });
  it('NEVER lists a hand-written source or lockfile', () => {
    for (const f of GENERATED_FILES) {
      expect(f.endsWith('.ts')).toBe(false);
      expect(f.endsWith('.tsx')).toBe(false);
      expect(f).not.toBe('pnpm-lock.yaml');
    }
  });
  it('is a small, reviewable allowlist rather than a glob', () => {
    expect(GENERATED_FILES.length).toBeLessThanOrEqual(3);
    for (const f of GENERATED_FILES) expect(f).not.toContain('*');
  });
});

describe('gitattributesContent', () => {
  it('maps every generated file to the driver', () => {
    const out = gitattributesContent();
    for (const f of GENERATED_FILES) {
      expect(out).toContain(f + ' merge=' + DRIVER_NAME);
    }
  });
  it('explains WHY inline, since .gitattributes is easy to cargo-cult', () => {
    expect(gitattributesContent()).toContain('#');
  });
  it('ends with a trailing newline', () => {
    expect(gitattributesContent().endsWith(String.fromCharCode(10))).toBe(true);
  });
});

describe('driverConfigEntries', () => {
  it('registers a name and a driver body', () => {
    const e = driverConfigEntries();
    const keys = e.map((x) => x.key);
    expect(keys).toContain('merge.' + DRIVER_NAME + '.name');
    expect(keys).toContain('merge.' + DRIVER_NAME + '.driver');
  });
  it('uses the incoming side, which git passes as %B', () => {
    const driver = driverConfigEntries().find((x) => x.key.endsWith('.driver'));
    expect(driver?.value).toContain('%B');
    expect(driver?.value).toContain('%A');
  });
});

describe('gitConfigArgs', () => {
  it('writes to the LOCAL config, never global', () => {
    const a = gitConfigArgs('merge.x.name', 'v');
    expect(a).toEqual(['config', '--local', 'merge.x.name', 'v']);
  });
  it('rejects a blank key rather than corrupting config', () => {
    expect(() => gitConfigArgs('', 'v')).toThrow();
  });
});

describe('isRegistered', () => {
  it('is true only when every entry is already present', () => {
    const e = driverConfigEntries();
    const existing = new Map(e.map((x) => [x.key, x.value]));
    expect(isRegistered(existing)).toBe(true);
  });
  it('is false when an entry is missing', () => {
    expect(isRegistered(new Map())).toBe(false);
  });
  it('is false when an entry holds a DIFFERENT value, so drift re-registers', () => {
    const e = driverConfigEntries();
    const stale = new Map(e.map((x) => [x.key, 'stale']));
    expect(isRegistered(stale)).toBe(false);
  });
});
