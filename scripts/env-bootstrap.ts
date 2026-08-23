// scripts/env-bootstrap.ts
// PURE CORE for the SOPS/age env bootstrap. No I/O, no process spawning: every
// rule here is exhaustively unit-tested without touching disk or network. The
// imperative shell lives in env-bootstrap-cli.ts, mirroring the
// terminal-registry.ts / terminal-registry-cli.ts split.
//
// WHY THIS EXISTS. The repo blocks .env from git (.gitignore) and scans for
// leaked credentials (local-secret-guard on the working tree, detect-secrets on
// the index), but NOTHING ever produced a .env. Prevention without provisioning
// is why a new machine still required a human file copy over AirDrop or chat --
// plaintext secrets on N laptops, no rotation path, no record of which host
// holds which vintage. This closes the provisioning half.
//
// SOPS encrypts VALUES only; keys (field names) stay readable, so the encrypted
// file diffs and reviews like normal config. age is the recipient scheme: each
// machine holds its own private identity, and the file is encrypted to every
// machine's PUBLIC key, so adding or revoking a laptop is a re-encrypt against
// an edited recipient list -- never a re-copy.
import { z } from 'zod';

/** Untracked plaintext, gitignored. Never committed, never encrypted in place. */
export const PLAINTEXT_ENV_FILE = '.env';

/** Encrypted artifact. TRACKED: values are ciphertext, field names stay legible. */
export const ENCRYPTED_ENV_FILE = '.env.sops.yaml';

/** sops reads this at the repo root to decide recipients per file pattern. */
export const SOPS_CONFIG_FILE = '.sops.yaml';

/** One recipient public key per line; comments and blanks allowed. TRACKED. */
export const RECIPIENTS_FILE = '.age-recipients';

const NL = String.fromCharCode(10);
const SQ = String.fromCharCode(39);
const HASH = String.fromCharCode(35);

// An age recipient is bech32: the literal prefix age1 then 58 lowercase
// alphanumeric characters from the bech32 charset (no 1, b, i or o). Anchored
// at both ends so a private key -- which carries the AGE-SECRET-KEY- prefix and
// would be catastrophic to publish as a recipient -- can never match, and
// neither can an ssh key or arbitrary prose.
const AGE_RECIPIENT_RE = /^age1[02-9ac-hj-np-z]{58}$/;

/** Prefix identifying a roster line as a key rather than a comment or blank. A
 *  literal prefix, not an anchored regex: eslint's
 *  prefer-string-starts-ends-with rejects /^.../.test(), and startsWith says
 *  what is meant without the reader parsing a pattern for anchors. */
export const AGE_PREFIX = 'age1';

/** True only for a well-formed age PUBLIC key. Fail-closed on everything else. */
export function validateAgeRecipient(candidate: string): boolean {
  return AGE_RECIPIENT_RE.test(candidate);
}

const RecipientSchema = z.string().refine(validateAgeRecipient, {
  message: 'not a valid age public recipient (expected age1... 62 chars)',
});

const RecipientListSchema = z
  .array(RecipientSchema)
  .min(1, 'refusing to encrypt to an empty recipient list');

/** Parse the recipients file: order-preserving, comment- and blank-tolerant.
 *  Throws on ANY malformed entry rather than silently dropping it -- a dropped
 *  recipient means a machine that can no longer decrypt, discovered later. */
export function parseRecipients(content: string): readonly string[] {
  const lines = content
    .split(NL)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(HASH));
  return Object.freeze(RecipientListSchema.parse(lines));
}

/** One machine's entry: the host comment immediately above its public key.
 *
 *  WHY THIS EXISTS. The roster header carried a hand-maintained ESTATE list
 *  naming every machine, beside the key list that is the actual grant. Nothing
 *  connected them -- parseRecipients strips comments -- so the list was prose,
 *  and the header indicts exactly that: "no comment, table or status word
 *  grants access". It had drifted again by the same arithmetic that produced
 *  the drift it was written to fix: four machines named, two keys listed.
 *
 *  A host is IDENTIFIED by the comment directly above its key, an adjacency the
 *  roster guard already enforces, so the estate is DERIVABLE and needs no
 *  second declaration to fall out of step with. */
export interface RecipientEntry {
  readonly host: string;
  readonly key: string;
}

/** Every (host, key) pair in file order. The host is the comment line directly
 *  above the key, stripped of its marker and any parenthetical detail, so
 *  "# Thanhs-MBP-2 (Apple Silicon, macOS 15.7)" yields "Thanhs-MBP-2".
 *
 *  Returns PAIRS rather than a name list so a caller can report which grant is
 *  missing for a host, not merely that some machine is absent. */
export function parseRecipientEntries(content: string): readonly RecipientEntry[] {
  const lines = content.split(NL);
  const entries: RecipientEntry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith(AGE_PREFIX)) continue;
    const above = (lines[i - 1] ?? '').trim();
    // A key with no comment above it is a roster defect the guard already
    // rejects, so an empty host here surfaces rather than being tolerated.
    const host = above.startsWith(HASH) ? (above.slice(1).split('(')[0] ?? '').trim() : '';
    entries.push(Object.freeze({ host, key: line }));
  }
  return Object.freeze(entries);
}

/** The hosts that can actually decrypt: exactly the machines holding a key. */
export function rosterHosts(content: string): readonly string[] {
  return Object.freeze(parseRecipientEntries(content).map((e) => e.host));
}

/** Escape every dot of a filename as a bracketed character class and anchor it.
 *
 *  Bare dots are regex wildcards, so an unescaped pattern silently claims
 *  lookalikes: .env.sops.yaml would also match .envXsopsXyaml. The first draft
 *  used String.replace with a STRING pattern, which in JavaScript replaces only
 *  the FIRST occurrence -- exactly the kind of defect that reads as correct.
 *
 *  Bracketed classes rather than backslash escapes because the value is embedded
 *  in YAML, where a backslash inside a double-quoted scalar is itself an escape
 *  character and would need doubling -- one more layer to get wrong silently. */
function anchoredFileRegex(filename: string): string {
  return filename.split('.').join('[.]') + '$';
}

/** The path_regex sops matches to decide WHICH FILE this creation rule governs.
 *
 *  IT TARGETS THE PLAINTEXT INPUT, NOT THE CIPHERTEXT OUTPUT. That reads
 *  backwards and is the third and subtlest defect these lines produced: sops
 *  resolves a creation rule against the file it is READING, so for encryption
 *  that is .env. The rule was first written for .env.sops.yaml -- the file being
 *  produced -- and sops answered 'no matching creation rules found' and refused.
 *  Neither regex correctness nor YAML validity could surface it; only executing
 *  the real tool did, which is why the round-trip is exercised and not assumed.
 *
 *  Read the file as answering: "when asked to encrypt THIS path, who are the
 *  recipients?" DEcryption consults no creation rule at all -- the ciphertext
 *  carries its own recipients in its sops metadata block once written.
 *
 *  Anchoring is load-bearing beyond tidiness: .env.example is a TRACKED template
 *  with no secrets sitting right beside the real file, and an unanchored rule
 *  would claim it, encrypting the very file new contributors are meant to read. */
export function creationRulePathRegex(): string {
  return anchoredFileRegex(PLAINTEXT_ENV_FILE);
}

/** Regex matching the encrypted artifact. Not used in the creation rule (see
 *  creationRulePathRegex); kept as the SSOT for any caller that needs to
 *  recognise the ciphertext by path, so the pattern is never hand-rewritten. */
export function encryptedFilePathRegex(): string {
  return anchoredFileRegex(ENCRYPTED_ENV_FILE);
}

/** Wrap a scalar in SINGLE quotes for YAML emission.
 *
 *  ROOT CAUSE THIS CLOSES: the regex was emitted UNQUOTED, and a bare leading [
 *  opens a YAML FLOW SEQUENCE. sops refused the whole config with 'Could not
 *  unmarshal config file: yaml: did not find expected key' -- the pattern was
 *  right, the SERIALIZATION was wrong, and no string-level assertion could see
 *  it because matching a substring of invalid YAML passes happily.
 *
 *  SINGLE quotes specifically: YAML performs NO escape processing inside them,
 *  so backslashes, brackets, dollar signs and braces -- everything a regex is
 *  built from -- survive byte-identically. Double quotes treat backslash as an
 *  escape introducer and would silently mangle any pattern that uses one. The
 *  only character needing care is the single quote itself, which YAML escapes
 *  by doubling. */
export function yamlSingleQuote(value: string): string {
  return SQ + value.split(SQ).join(SQ + SQ) + SQ;
}

/** Render .sops.yaml. Deterministic: same recipients render byte-identical
 *  output, so a regenerated config produces an empty diff when nothing changed. */
export function renderSopsConfig(recipients: readonly string[]): string {
  const validated = RecipientListSchema.parse([...recipients]);
  const joined = validated.join(',' + NL + '        ');
  return [
    HASH + ' ' + SOPS_CONFIG_FILE,
    HASH + ' GENERATED by env:recipients -- edit ' + RECIPIENTS_FILE + ', never this file.',
    HASH + ' The rule below targets the PLAINTEXT input sops is asked to encrypt.',
    HASH + ' Values in ' + ENCRYPTED_ENV_FILE + ' are encrypted to every recipient listed.',
    HASH + ' Field NAMES stay plaintext by design so the file reviews and diffs.',
    'creation_rules:',
    '  - path_regex: ' + yamlSingleQuote(creationRulePathRegex()),
    '    age: >-',
    '        ' + joined,
    '',
  ].join(NL);
}

/** argv for encrypting plaintext -> ciphertext. Writes a SEPARATE output file:
 *  encrypting in place would destroy the only plaintext copy on a bad run. */
export function encryptArgs(): readonly string[] {
  return Object.freeze([
    '--encrypt',
    '--input-type',
    'dotenv',
    '--output-type',
    'yaml',
    '--output',
    ENCRYPTED_ENV_FILE,
    PLAINTEXT_ENV_FILE,
  ]);
}

/** argv for decrypting ciphertext -> dotenv on stdout. Output type is dotenv,
 *  not yaml: the consumer is a .env file that dotenv/compose read natively.
 *  The private identity is supplied via SOPS_AGE_KEY_FILE in the environment,
 *  never as an argument -- argv is world-readable in the process table. */
export function decryptArgs(): readonly string[] {
  return Object.freeze([
    '--decrypt',
    '--input-type',
    'yaml',
    '--output-type',
    'dotenv',
    ENCRYPTED_ENV_FILE,
  ]);
}
