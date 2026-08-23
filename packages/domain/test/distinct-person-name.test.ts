// packages/domain/test/distinct-person-name.test.ts
import { describe, it, expect } from 'vitest';
import {
  suggestDistinctDriverName,
  DISTINCT_NAME_SUFFIXES,
} from '../src/identity/distinct-person-name.js';

// Vietnamese driver names repeat rarely but they DO repeat. When a dispatcher
// registers a genuine second person with an existing name, a bare "already
// exists" 409 is a dead end -- the dispatcher has no sanctioned way forward and
// will invent one (a trailing space, a stray dot, a case tweak), which is how
// duplicate identities got created in the first place. The business rule is: the
// second real person is registered with a distinguishing suffix -- B, then C,
// and so on. This pure helper computes the next free suffix so the API can name
// it in the conflict message and the dispatcher just types what it says.
describe('suggestDistinctDriverName', () => {
  it('returns the base name unchanged when nothing is taken', () => {
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', [])).toBe('NGUYỄN AN BÌNH ĐỨC');
  });

  it('suggests B when the bare name is taken', () => {
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', ['NGUYỄN AN BÌNH ĐỨC'])).toBe(
      'NGUYỄN AN BÌNH ĐỨC B',
    );
  });

  it('suggests C when the bare name and B are taken', () => {
    const taken = ['NGUYỄN AN BÌNH ĐỨC', 'NGUYỄN AN BÌNH ĐỨC B'];
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', taken)).toBe('NGUYỄN AN BÌNH ĐỨC C');
  });

  it('skips a gap rather than reusing a freed letter, so suffixes never collide', () => {
    // B was retired, C is live. Reusing B would hand a new person the identity a
    // dispatcher may still associate with the old one; take the next unused.
    const taken = ['NGUYỄN AN BÌNH ĐỨC', 'NGUYỄN AN BÌNH ĐỨC C'];
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', taken)).toBe('NGUYỄN AN BÌNH ĐỨC D');
  });

  // The taken-list comes from lower(full_name) rows, and dispatchers key case
  // freely, so matching MUST reuse the same fold as the DB unique index.
  it('matches taken names case-insensitively', () => {
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', ['nguyễn an bình đức'])).toBe(
      'NGUYỄN AN BÌNH ĐỨC B',
    );
  });

  it('matches taken names through invisible characters and spacing noise', () => {
    const taken = ['NGUYỄN  AN\u200e BÌNH ĐỨC'];
    expect(suggestDistinctDriverName('NGUYỄN AN BÌNH ĐỨC', taken)).toBe('NGUYỄN AN BÌNH ĐỨC B');
  });

  it('is accent-SENSITIVE: an unaccented twin is a DIFFERENT person, not a conflict', () => {
    expect(suggestDistinctDriverName('LÊ VĂN CHÂU', ['LE VAN CHAU'])).toBe('LÊ VĂN CHÂU');
  });

  it('normalizes the returned suggestion so it is byte-stable', () => {
    expect(suggestDistinctDriverName('  NGUYỄN   AN ', ['NGUYỄN AN'])).toBe('NGUYỄN AN B');
  });

  it('returns null when every suffix is exhausted rather than inventing one', () => {
    const base = 'NGUYỄN AN';
    const taken = [base, ...DISTINCT_NAME_SUFFIXES.map((s) => base + ' ' + s)];
    expect(suggestDistinctDriverName(base, taken)).toBeNull();
  });
});

describe('DISTINCT_NAME_SUFFIXES', () => {
  it('starts at B, because the first person carries the bare name', () => {
    expect(DISTINCT_NAME_SUFFIXES[0]).toBe('B');
  });
  it('is ASCII-only so the suffix can never itself introduce a unicode variant', () => {
    for (const s of DISTINCT_NAME_SUFFIXES) expect(/^[A-Z]$/.test(s)).toBe(true);
  });
});
