// packages/codemods/test/registry-format.test.ts
// formatCodemodList renders the CLI's --help listing, and its SEPARATORS are
// the whole point of the function.
//
// registry.test.ts asserts that every name and description appears in the
// output. That holds while all three delimiters collapse to empty strings, so
// mutation testing found three survivors on the single line that builds it:
//   name + '  [' + kind + ']  ' + description   joined by '\n'
// Drop the brackets and the kind runs into the name; drop the newline and the
// entire registry becomes one unreadable line. Both are exactly what an
// operator reading --help would notice first, and nothing tested either.
import { describe, it, expect } from 'vitest';
import { CODEMODS, formatCodemodList } from '../src/registry.js';

describe('formatCodemodList is readable, not merely complete', () => {
  // Kills the '\n' StringLiteral mutant: without it every entry concatenates
  // into a single line.
  it('puts each codemod on its own line', () => {
    expect(formatCodemodList().split('\n')).toHaveLength(CODEMODS.length);
  });

  // Kills the '  [' mutant: the kind must be bracketed and set off from the
  // name, or 'extract-parse-one-numberproject' reads as one token.
  it('brackets the kind and separates it from the name', () => {
    for (const c of CODEMODS) {
      expect(formatCodemodList()).toContain(c.name + '  [' + c.kind + ']');
    }
  });

  // Kills the ']  ' mutant: the description must be set off from the closing
  // bracket rather than butted against it.
  it('separates the description from the closing bracket', () => {
    for (const c of CODEMODS) {
      expect(formatCodemodList()).toContain(']  ' + c.description);
    }
  });

  // The whole line, end to end -- the strongest form of the contract, and the
  // one a reader can check against the source at a glance.
  it('renders each entry as name, bracketed kind, then description', () => {
    const lines = formatCodemodList().split('\n');
    for (const [i, c] of CODEMODS.entries()) {
      expect(lines[i]).toBe(c.name + '  [' + c.kind + ']  ' + c.description);
    }
  });
});
