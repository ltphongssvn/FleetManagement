// scripts/env-bootstrap-pathregex.test.ts
// Contract for the filename REGEXES the sops config is built from.
//
// ROOT CAUSE THIS CLOSES, caught 2026-08-09 by reading the generated file
// rather than trusting that it rendered: the escaper used String.replace with
// a STRING pattern, which in JavaScript replaces ONE occurrence, not all. The
// emitted rule was [.]env.sops.yaml$, whose remaining bare dots are regex
// wildcards, so it also matched .envXsopsXyaml and anything of that shape.
//
// Why this matters beyond tidiness: path_regex decides WHICH FILES SOPS
// ENCRYPTS. Too loose silently claims files it was never meant to govern; too
// tight silently governs nothing, and sops then reports no matching creation
// rule, which reads as a tooling failure rather than a config bug. Neither
// announces itself, so the patterns are asserted here rather than eyeballed.
//
// SCOPE. This file asserts the PATTERNS and their YAML quoting helper. Two
// sibling concerns are deliberately elsewhere, because each needed a different
// instrument to catch its own defect: env-bootstrap-yaml.test.ts PARSES the
// rendered config (a substring assertion cannot see invalid YAML), and
// env-bootstrap-creationrule.test.ts asserts WHICH FILE the rule targets (no
// static assertion could see that at all -- only running sops did).
import { describe, it, expect } from 'vitest';
import {
  ENCRYPTED_ENV_FILE,
  PLAINTEXT_ENV_FILE,
  creationRulePathRegex,
  encryptedFilePathRegex,
  renderSopsConfig,
  yamlSingleQuote,
} from './env-bootstrap.js';

const KEY_A = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
const SQ = String.fromCharCode(39);

describe('encryptedFilePathRegex', () => {
  it('escapes EVERY dot, not just the first', () => {
    expect(encryptedFilePathRegex()).toBe('[.]env[.]sops[.]yaml$');
  });

  it('matches the real encrypted filename', () => {
    expect(new RegExp(encryptedFilePathRegex()).test(ENCRYPTED_ENV_FILE)).toBe(true);
  });

  it('matches the file at a nested path', () => {
    expect(new RegExp(encryptedFilePathRegex()).test('some/dir/' + ENCRYPTED_ENV_FILE)).toBe(true);
  });

  it('does NOT match a lookalike where dots are other characters', () => {
    const re = new RegExp(encryptedFilePathRegex());
    expect(re.test('XenvXsopsXyaml')).toBe(false);
    expect(re.test('-env-sops-yaml')).toBe(false);
  });

  it('is anchored at the end so a suffixed copy is not claimed', () => {
    const re = new RegExp(encryptedFilePathRegex());
    expect(re.test('.env.sops.yaml.bak')).toBe(false);
    expect(re.test('.env.sops.yaml.orig')).toBe(false);
  });
});

describe('creationRulePathRegex', () => {
  it('escapes the leading dot of the plaintext filename', () => {
    expect(creationRulePathRegex()).toBe('[.]env$');
  });

  it('matches the plaintext file', () => {
    expect(new RegExp(creationRulePathRegex()).test(PLAINTEXT_ENV_FILE)).toBe(true);
  });

  it('does NOT match a lookalike where the dot is another character', () => {
    expect(new RegExp(creationRulePathRegex()).test('Xenv')).toBe(false);
  });
});

describe('yamlSingleQuote', () => {
  it('wraps a plain scalar in single quotes', () => {
    expect(yamlSingleQuote('abc')).toBe(SQ + 'abc' + SQ);
  });

  it('leaves regex metacharacters byte-identical -- no escape processing', () => {
    const pattern = '[.]a\\d+$';
    expect(yamlSingleQuote(pattern)).toBe(SQ + pattern + SQ);
  });

  it('doubles an embedded single quote, the one YAML escape that applies', () => {
    expect(yamlSingleQuote("it's")).toBe(SQ + 'it' + SQ + SQ + 's' + SQ);
  });
});

describe('renderSopsConfig path_regex', () => {
  it('emits the creation rule single-quoted for YAML', () => {
    const expected = 'path_regex: ' + SQ + creationRulePathRegex() + SQ;
    expect(renderSopsConfig([KEY_A])).toContain(expected);
  });

  it('emits no unescaped dot in the rule line', () => {
    const line = renderSopsConfig([KEY_A])
      .split(String.fromCharCode(10))
      .find((l) => l.includes('path_regex'));
    expect(line).toBeDefined();
    expect(String(line).replace(/\[\.\]/g, '')).not.toContain('.');
  });
});
