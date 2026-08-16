// scripts/env-bootstrap-yaml.test.ts
// Contract: .sops.yaml must be VALID YAML, not merely correct-looking text.
//
// ROOT CAUSE THIS CLOSES, caught 2026-08-09 by running the real encrypt rather
// than trusting the rendered string: the path_regex value was emitted UNQUOTED
// as [.]env$. In YAML a bare leading [ opens a FLOW SEQUENCE, so the parser
// read the value as a malformed inline list and sops aborted with 'error
// loading config: Could not unmarshal config file: yaml: line 5: did not find
// expected key'. The regex itself was correct; the SERIALIZATION was not.
//
// This was the second of three defects in the same three lines, and the set is
// the lesson. The first (unescaped dots) was a correctness bug the eye could
// not see. This one is an encoding bug that string-level assertions could not
// see, because toContain('path_regex: [.]env...') passes happily on text no
// YAML parser will accept. The third (the rule targeting the wrong file) no
// static assertion could see at all -- only executing sops surfaced it. Hence
// the division of labour: this file PARSES the output, env-bootstrap-creation
// rule.test.ts asserts WHICH FILE the rule governs, and the round-trip is run
// for real. A generator of config files must be tested by parsing what it
// emits, never by matching substrings, or the tests agree with the generator
// and both are wrong together.
//
// Single-quoted YAML is the correct quoting here: inside single quotes YAML
// performs NO escape processing, so backslashes, brackets and dollar signs --
// every character a regex is made of -- survive byte-identically. Double quotes
// would treat backslash as an escape introducer and silently mangle any future
// pattern that uses one.
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  PLAINTEXT_ENV_FILE,
  creationRulePathRegex,
  renderSopsConfig,
} from './env-bootstrap.js';

const KEY_A = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
const KEY_B = 'age1lggyhqrw2nlhcxprm67z43rta597azn8gknawjehu9d9dl0jq3yqqvfjug';

interface SopsConfig {
  readonly creation_rules?: readonly { readonly path_regex?: unknown; readonly age?: unknown }[];
}

// parseYaml is typed any, so every call site would leak an unsafe value into a
// typed position. Funnel it through ONE boundary that returns unknown and then
// narrows, rather than casting at each use: a cast repeated seven times is
// seven chances to cast to the wrong shape, and no-unsafe-return exists to stop
// exactly that spread.
function parseSopsConfig(yaml: string): SopsConfig {
  const parsed: unknown = parseYaml(yaml) as unknown;
  const doc: SopsConfig = (parsed ?? {}) as SopsConfig;
  return doc;
}

describe('renderSopsConfig emits parseable YAML', () => {
  it('parses without throwing', () => {
    expect(() => {
      parseSopsConfig(renderSopsConfig([KEY_A]));
    }).not.toThrow();
  });

  it('parses with multiple recipients without throwing', () => {
    expect(() => {
      parseSopsConfig(renderSopsConfig([KEY_A, KEY_B]));
    }).not.toThrow();
  });

  it('yields creation_rules as a list with one rule', () => {
    const doc = parseSopsConfig(renderSopsConfig([KEY_A]));
    expect(Array.isArray(doc.creation_rules)).toBe(true);
    expect(doc.creation_rules).toHaveLength(1);
  });

  it('round-trips path_regex as a STRING, not a parsed sequence', () => {
    const doc = parseSopsConfig(renderSopsConfig([KEY_A]));
    const rule = doc.creation_rules?.[0];
    expect(typeof rule?.path_regex).toBe('string');
    expect(rule?.path_regex).toBe(creationRulePathRegex());
  });

  it('the parsed regex still matches the plaintext file sops encrypts', () => {
    const doc = parseSopsConfig(renderSopsConfig([KEY_A]));
    const pattern = String(doc.creation_rules?.[0]?.path_regex);
    expect(new RegExp(pattern).test(PLAINTEXT_ENV_FILE)).toBe(true);
  });

  it('the parsed regex still rejects the tracked .env.example template', () => {
    const doc = parseSopsConfig(renderSopsConfig([KEY_A]));
    const pattern = String(doc.creation_rules?.[0]?.path_regex);
    expect(new RegExp(pattern).test('.env.example')).toBe(false);
  });

  it('round-trips every recipient into the age field', () => {
    const doc = parseSopsConfig(renderSopsConfig([KEY_A, KEY_B]));
    const age = String(doc.creation_rules?.[0]?.age);
    expect(age).toContain(KEY_A);
    expect(age).toContain(KEY_B);
  });

  it('quotes the regex so a leading bracket cannot open a flow sequence', () => {
    const line = renderSopsConfig([KEY_A])
      .split(String.fromCharCode(10))
      .find((l) => l.includes('path_regex'));
    expect(String(line)).toContain(String.fromCharCode(39));
  });
});
