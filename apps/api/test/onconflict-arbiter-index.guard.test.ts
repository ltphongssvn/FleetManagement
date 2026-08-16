// apps/api/test/onconflict-arbiter-index.guard.test.ts
// Business invariant (permanent rule): an ON CONFLICT target must name a
// arbiter index that is NOT partial, or supply targetWhere.
//
// REAL INCIDENT (2026-08-11). Migration 20260810180000 replaced the plain
// driver_company_phone_uq with a PARTIAL index. That silently broke
// reference-seed.ts -- a call site the migration never touched -- which had
// named target (company_id, phone) since long before. Postgres infers the
// arbiter FROM the target, and a partial index only qualifies when the
// statement predicate IMPLIES the index predicate, so the seed began raising:
//
//   42P10  there is no unique or exclusion constraint matching the
//          ON CONFLICT specification    (plancat.c, infer_arbiter_indexes)
//
// maybeSeed runs at BOOT, so that was not a failed query: it was the API
// exiting 1, Railway reporting Completed rather than Online, and /health/ready
// returning 502 until DB_AUTO_MIGRATE was set false.
//
// WHY A GUARD AND NOT A SURVEY. An audit proves today is fine and prevents
// nothing. The hazard is delayed and remote: the edit that breaks a call site
// is a schema change in a DIFFERENT file, and nothing fails until a container
// refuses to start. This fails in the PR that makes an index partial, naming
// the call site that will crash.
//
// SCOPE. Targeted conflicts only. A BARE onConflictDoNothing() is deliberately
// out of scope and is the SAFER form: with no target, Postgres treats ANY
// unique violation as the no-op, so the statement stays decoupled from index
// internals. That is the shape the seed was moved to.
//
// THIS GUARD IS MUTATION-TESTED. An earlier cut passed 4/4 while the original
// defect was injected back into the seed -- it matched on a truncated first
// line of the call, so a target on a continuation line was invisible, and a
// single-line target slipped through a mis-sliced window. A guard that cannot
// fail is a confident zero. The detector-sanity and column-set cases below
// exist because both failure modes actually occurred here.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(API_ROOT, 'src');
const SCHEMA_DIR = join(SRC, 'database', 'schema');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

export interface PartialIndex {
  readonly name: string;
  readonly columns: readonly string[];
}

// Every uniqueIndex(...) carrying a .where(...) is PARTIAL and cannot serve as
// an arbiter without targetWhere. Read from source, never hardcoded, so a
// newly-added partial index is covered the day it lands.
//
// Segment-split rather than a lookahead regex: the driver indexes place their
// .where() past a multi-line .on(...) containing sql template blocks, which no
// bounded window caught. That miss was silent until the sanity case below.
function partialUniqueIndexes(): PartialIndex[] {
  const found: PartialIndex[] = [];
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const seg of text.split(/uniqueIndex\(/).slice(1)) {
      const nameMatch = /^\s*'([^']+)'/.exec(seg);
      const name = nameMatch?.[1];
      if (name === undefined) continue;
      const endIdx = seg.search(/\n\s*(unique\(|index\(|check\(|\]\s*,?\s*\))/);
      const body = endIdx === -1 ? seg : seg.slice(0, endIdx);
      if (!body.includes('.where(')) continue;
      // Column identifiers from the .on(...) call: t.companyId -> companyId.
      const onMatch = /\.on\(([\s\S]*?)\)\s*\n?\s*\.where\(/.exec(body);
      const cols = [...(onMatch?.[1] ?? '').matchAll(/\bt\.([A-Za-z0-9_]+)/g)]
        .map((m) => m[1])
        .filter((c): c is string => c !== undefined);
      found.push({ name, columns: cols });
    }
  }
  return found;
}

export interface ConflictSite {
  readonly file: string;
  readonly line: number;
  readonly target: string;
  readonly hasTargetWhere: boolean;
}

// Reads the WHOLE call argument, not just its first line. The earlier version
// sliced at the first '})' in an 8-line window, which truncated multi-line
// calls and mis-sliced single-line ones -- the bug the mutation test exposed.
function conflictSites(): ConflictSite[] {
  const sites: ConflictSite[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!line.includes('onConflictDo')) continue;
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      const call = lines.slice(i, i + 12).join('\n');
      const targetMatch = /target\s*:\s*(\[[^\]]*\]|[A-Za-z0-9_.]+)/.exec(call);
      const target = targetMatch?.[1];
      if (target === undefined) continue;
      sites.push({
        file: file.slice(API_ROOT.length + 1),
        line: i + 1,
        target,
        hasTargetWhere: /targetWhere\s*:/.test(call),
      });
    }
  }
  return sites;
}

// A target's column identifiers, e.g. [driver.companyId, driver.phone] ->
// ['companyId','phone']; manifest.manifestCorrelationId -> ['manifestCorrelationId'].
function targetColumns(target: string): string[] {
  return [...target.matchAll(/\.([A-Za-z0-9_]+)/g)]
    .map((m) => m[1])
    .filter((c): c is string => c !== undefined);
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

describe('ON CONFLICT targets must name a usable arbiter index', () => {
  it('finds the targeted conflict sites it is meant to guard', () => {
    expect(conflictSites().length).toBeGreaterThan(4);
  });

  it('detects the partial unique indexes from schema source', () => {
    // Detector sanity: without this the guard silently protects nothing.
    const names = partialUniqueIndexes().map((p) => p.name);
    expect(names).toContain('driver_company_active_name_ci_uq');
    expect(names).toContain('driver_company_active_phone_uq');
  });

  it('extracts the column set of each partial index', () => {
    const phone = partialUniqueIndexes().find((p) => p.name === 'driver_company_active_phone_uq');
    expect(phone).toBeDefined();
    expect(phone?.columns).toEqual(['companyId', 'phone']);
  });

  it('no targeted conflict matches a partial index column set without targetWhere', () => {
    // THE INVARIANT. A target whose columns equal a partial index's columns is
    // unusable as written: Postgres will refuse to infer that arbiter.
    const partials = partialUniqueIndexes();
    const offenders = conflictSites()
      .filter((s) => !s.hasTargetWhere)
      .filter((s) => partials.some((p) => sameColumns(p.columns, targetColumns(s.target))))
      .map((s) => s.file + ':' + String(s.line) + ' target ' + s.target);
    expect(offenders).toEqual([]);
  });
});
