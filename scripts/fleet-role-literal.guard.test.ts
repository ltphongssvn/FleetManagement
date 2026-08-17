// scripts/fleet-role-literal.guard.test.ts
// ARCHITECTURAL GUARD: a fleet realm-role name may be written as a string
// literal in exactly ONE file -- packages/domain/src/identity/fleet-role.ts.
// Everywhere else it must be imported.
//
// WHY A RATCHET AND NOT JUST THE MOVE. Relocating FLEET_OWNER_ROLE into
// @fleet/domain fixes today's instance and does nothing about tomorrow's. The
// next engineer needing a role name will reach for the shortest path that
// compiles -- roles.includes('fleet-accounting') inline -- and the SSOT quietly
// has two sources again, with no test failing to say so. That is exactly how
// the constant came to be app-local in the first place: nothing forbade it.
//
// This repo already answers this shape with executable constraints rather than
// prose: ci-fast-covers-test-scripts, worktree-sweep-registered,
// turbo-version-floor, rn-workspace-deps-resolve. A comment is documentation,
// which people do not read; a review note is reactive and inconsistent. A guard
// fails the build.
//
// WHY IT READS THE SSOT AS TEXT INSTEAD OF IMPORTING IT. The obvious version
// was an ordinary import of FLEET_ROLES from @fleet/domain. It does not
// typecheck, and the failure is the design telling us something: scripts/
// belongs to no
// workspace package -- that is the documented reason //#lint:scripts,
// //#typecheck:scripts and //#test:scripts exist at all -- and its tsconfig
// includes only scripts/**. Sixty-plus other scripts manage without a workspace
// import; this file would have been the first to cross that line. The 2026 rule
// is directional: apps depend on packages, packages depend on packages, and
// nothing flows the other way. Adding a path mapping would have papered over an
// inverted edge.
//
// Reading the source text is strictly better here anyway. It derives from the
// SAME file the guard protects, so it cannot drift; it needs no build step, so
// it works on a cold checkout; and it verifies the AUTHORED source rather than
// a compiled artifact, which is what the rule is actually about.
//
// SCOPE. Tracked TypeScript only, excluding the SSOT itself, dist/, and test
// files. Tests legitimately write the literal: asserting FLEET_OWNER_ROLE equals
// 'fleet-owner' IS the contract, and a test that imported the constant it is
// verifying would prove nothing.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** The one file allowed to write a fleet role name as a literal. */
const SSOT_FILE = 'packages/domain/src/identity/fleet-role.ts';

/** Extracts the declared role vocabulary from the SSOT's SOURCE.
 *
 *  Matches only quoted fleet-* strings that are ASSIGNED to a SCREAMING_CASE
 *  const -- the shape a role declaration takes -- so prose in that file's own
 *  header comments cannot inflate the vocabulary. */
function declaredRoles(): readonly string[] {
  const src = readFileSync(join(ROOT, SSOT_FILE), 'utf-8');
  const re = /export const [A-Z][A-Z0-9_]*\s*=\s*['"](fleet-[a-z][a-z0-9-]*)['"]/g;
  const found = new Set<string>();
  for (const m of src.matchAll(re)) {
    const role = m[1];
    if (role !== undefined) found.add(role);
  }
  return [...found];
}

/** Matches a quoted string that is EXACTLY a declared fleet role.
 *
 *  THE FIRST DRAFT WAS /['"]fleet-[a-z][a-z0-9-]*['"]/ -- any fleet-prefixed
 *  literal -- reasoning that it would also catch roles not invented yet. Its
 *  first run returned FIFTEEN offenders and not one was a role: a JWT issuer
 *  (fleet-pilot-api), an audience (fleet-driver), a signing key id
 *  (fleet-api-1), an S3 bucket, an OTel service name, two Keycloak client ids,
 *  and Docker container names (fleet-pilot-postgres-1). All legitimately
 *  fleet-prefixed, none of them authorization vocabulary.
 *
 *  eslint.config.mjs states the consequence in this repo's own words: a rule
 *  that flags legitimate uses generates false positives and GETS DISABLED, and
 *  a guard developers switch off protects nothing. A guard failing on a
 *  container name would be deleted within a week, taking the real protection
 *  with it.
 *
 *  Anchored with word boundaries so a role name embedded in a longer string --
 *  fleet-owner-readonly -- is NOT matched: that is a different value, and
 *  flagging it would be another false positive. */
function roleLiteralPattern(roles: readonly string[]): RegExp {
  const alternatives = roles.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp('[\'"](' + alternatives + ')[\'"]');
}

function trackedTypeScriptSources(): readonly string[] {
  const out = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return out
    .split(String.fromCharCode(10))
    .filter((f) => f.length > 0)
    .filter((f) => !f.includes('/dist/'))
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => !f.endsWith('.test.tsx'))
    .filter((f) => !f.endsWith('.spec.ts'))
    .filter((f) => !f.includes('/test/'))
    .filter((f) => f !== SSOT_FILE);
}

function offendingLines(file: string, pattern: RegExp): readonly string[] {
  const src = readFileSync(join(ROOT, file), 'utf-8');
  return src
    .split(String.fromCharCode(10))
    .filter((line) => !line.trimStart().startsWith('//'))
    .filter((line) => !line.trimStart().startsWith('*'))
    .filter((line) => pattern.test(line));
}

describe('the SSOT is discoverable and non-empty', () => {
  it('extracts at least one declared role from the SSOT source', () => {
    expect(declaredRoles().length).toBeGreaterThan(0);
  });

  it('extracts the owner role', () => {
    expect(declaredRoles()).toContain('fleet-owner');
  });

  it('does NOT pick up fleet-prefixed prose from the SSOT comments', () => {
    expect(declaredRoles()).not.toContain('fleet-pilot-api');
    expect(declaredRoles()).not.toContain('fleet-owner-readonly');
  });
});

describe('fleet role literals live in exactly one file', () => {
  it('finds tracked TypeScript to scan -- an empty scan proves nothing', () => {
    expect(trackedTypeScriptSources().length).toBeGreaterThan(100);
  });

  it('the SSOT itself is excluded from the scan', () => {
    expect(trackedTypeScriptSources()).not.toContain(SSOT_FILE);
  });

  it('NO other tracked source writes a fleet role as a string literal', () => {
    const pattern = roleLiteralPattern(declaredRoles());
    const offenders: string[] = [];
    for (const file of trackedTypeScriptSources()) {
      for (const line of offendingLines(file, pattern)) {
        offenders.push(file + ': ' + line.trim());
      }
    }
    expect(
      offenders,
      'Import the role from @fleet/domain instead of writing the literal. ' +
        'New roles are added to packages/domain/src/identity/fleet-role.ts ' +
        'and nowhere else -- that is what makes it a single source of truth.',
    ).toEqual([]);
  });
});

describe('the pattern itself is sound', () => {
  const pattern = (): RegExp => roleLiteralPattern(['fleet-owner']);

  it('matches a single-quoted role name', () => {
    expect(pattern().test("const r = 'fleet-owner';")).toBe(true);
  });

  it('matches a double-quoted role name', () => {
    expect(pattern().test('roles.includes("fleet-owner")')).toBe(true);
  });

  it('extends automatically when a role joins the vocabulary', () => {
    const future = roleLiteralPattern(['fleet-owner', 'fleet-accounting']);
    expect(future.test("'fleet-accounting'")).toBe(true);
  });

  it('does NOT match a fleet-prefixed value that is not a role', () => {
    const p = pattern();
    expect(p.test("default('fleet-pilot-api')")).toBe(false);
    expect(p.test("kid: 'fleet-api-1'")).toBe(false);
    expect(p.test("'fleet-pilot-postgres-1'")).toBe(false);
    expect(p.test("default('fleet-driver')")).toBe(false);
  });

  it('does NOT match a role name embedded in a longer string', () => {
    expect(pattern().test("'fleet-owner-readonly'")).toBe(false);
  });

  it('does NOT match an unquoted identifier', () => {
    expect(pattern().test('FLEET_OWNER_ROLE')).toBe(false);
  });
});
