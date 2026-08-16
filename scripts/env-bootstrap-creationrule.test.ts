// scripts/env-bootstrap-creationrule.test.ts
// Contract: the creation rule must match the file sops actually CONSULTS IT FOR.
//
// ROOT CAUSE THIS CLOSES, found 2026-08-09 only by running the real encrypt:
// sops resolves a creation rule against the INPUT path -- the file being read,
// which for encryption is the plaintext .env -- not against the --output path.
// The rule was written for .env.sops.yaml, the file being PRODUCED, so sops
// reported 'no matching creation rules found' and refused. Both prior defects
// in these same three lines (unescaped dots, unquoted YAML) were about how the
// pattern was WRITTEN; this one is about which file it is FOR, and no amount of
// regex correctness or YAML validity could have surfaced it. Only executing the
// tool did.
//
// The rule therefore governs the PLAINTEXT path. That reads backwards at first
// glance and is worth stating plainly: .sops.yaml answers the question "when I
// am asked to encrypt THIS file, who are the recipients?", so the pattern names
// the input. The ciphertext carries its own recipients in its sops metadata
// block once written, which is why DEcryption needs no creation rule at all.
//
// The pattern must ALSO be tight enough to exclude .env.example -- a tracked
// template with no secrets that sits right beside the real file. A rule that
// claimed it would encrypt the very file new contributors are meant to read.
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  ENCRYPTED_ENV_FILE,
  PLAINTEXT_ENV_FILE,
  creationRulePathRegex,
  renderSopsConfig,
} from './env-bootstrap.js';

const KEY_A = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

interface SopsConfig {
  readonly creation_rules?: readonly { readonly path_regex?: unknown }[];
}

// parseYaml is typed any; narrow through unknown at ONE boundary so no unsafe
// value reaches a typed position (see the same helper in the yaml test).
function parseSopsConfig(yaml: string): SopsConfig {
  const parsed: unknown = parseYaml(yaml) as unknown;
  const doc: SopsConfig = (parsed ?? {}) as SopsConfig;
  return doc;
}

function ruleRegex(): RegExp {
  const doc = parseSopsConfig(renderSopsConfig([KEY_A]));
  return new RegExp(String(doc.creation_rules?.[0]?.path_regex));
}

describe('creationRulePathRegex targets the INPUT file', () => {
  it('matches the plaintext env file sops is asked to encrypt', () => {
    expect(new RegExp(creationRulePathRegex()).test(PLAINTEXT_ENV_FILE)).toBe(true);
  });

  it('matches the plaintext file at a nested path', () => {
    expect(new RegExp(creationRulePathRegex()).test('some/dir/' + PLAINTEXT_ENV_FILE)).toBe(true);
  });

  it('escapes the leading dot so it is not a wildcard', () => {
    expect(creationRulePathRegex()).toContain('[.]');
    expect(new RegExp(creationRulePathRegex()).test('Xenv')).toBe(false);
  });

  it('is anchored so .env.example is NOT claimed', () => {
    expect(new RegExp(creationRulePathRegex()).test('.env.example')).toBe(false);
  });

  it('does NOT claim .env.local or other sibling env files', () => {
    const re = new RegExp(creationRulePathRegex());
    expect(re.test('.env.local')).toBe(false);
    expect(re.test('.env.production')).toBe(false);
  });

  it('does NOT claim the ciphertext -- decryption needs no creation rule', () => {
    expect(new RegExp(creationRulePathRegex()).test(ENCRYPTED_ENV_FILE)).toBe(false);
  });
});

describe('rendered config carries the input-targeting rule', () => {
  it('the parsed rule matches the plaintext file', () => {
    expect(ruleRegex().test(PLAINTEXT_ENV_FILE)).toBe(true);
  });

  it('the parsed rule rejects .env.example', () => {
    expect(ruleRegex().test('.env.example')).toBe(false);
  });

  it('the config still parses as valid YAML', () => {
    expect(() => {
      parseSopsConfig(renderSopsConfig([KEY_A]));
    }).not.toThrow();
  });
});
