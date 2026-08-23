// scripts/merge-coverage.mjs
// Merge N v8 coverage-final.json files (one per CI shard) into one report
// and enforce the 90/90/90/90 per-file gate. Dependency-free: v8 coverage
// JSON is a flat { absPath: { s, b, f, statementMap, branchMap, fnMap } }
// map; merging is summing hit counts by id. statementMap/branchMap/fnMap are
// structural and identical across shards for a given file, so one copy is
// carried through. Exits non-zero if any non-excluded file is below 90% on
// statements, branches, functions, or lines.
//
// Usage: node scripts/merge-coverage.mjs <shardDir1> <shardDir2> ...
// Each shardDir is expected to contain a coverage-final.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const THRESHOLD = 90;
const shardDirs = process.argv.slice(2);
if (shardDirs.length === 0) {
  console.error('usage: node scripts/merge-coverage.mjs <dir> [<dir> ...]');
  process.exit(2);
}

// --- merge ---------------------------------------------------------------
const merged = {};
for (const dir of shardDirs) {
  const file = join(dir, 'coverage-final.json');
  if (!existsSync(file)) {
    console.error('missing coverage file: ' + file);
    process.exit(2);
  }
  const shard = JSON.parse(readFileSync(file, 'utf8'));
  for (const [path, cov] of Object.entries(shard)) {
    if (!merged[path]) {
      merged[path] = cov;
      continue;
    }
    const m = merged[path];
    for (const id of Object.keys(cov.s)) {
      m.s[id] = (m.s[id] ?? 0) + cov.s[id];
    }
    for (const id of Object.keys(cov.f)) {
      m.f[id] = (m.f[id] ?? 0) + cov.f[id];
    }
    for (const id of Object.keys(cov.b)) {
      const a = m.b[id] ?? [];
      const c = cov.b[id] ?? [];
      m.b[id] = c.map((v, i) => (a[i] ?? 0) + v);
    }
  }
}

mkdirSync('coverage/merged', { recursive: true });
writeFileSync('coverage/merged/coverage-final.json', JSON.stringify(merged) + '\n');

// --- per-file metrics ----------------------------------------------------
function pct(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

// v8 line coverage is derived from statements: a line is covered if any
// statement starting on it has a non-zero hit count.
function lineCoverage(cov) {
  const lines = new Map();
  for (const [id, loc] of Object.entries(cov.statementMap)) {
    const line = loc.start.line;
    const hit = cov.s[id] > 0;
    lines.set(line, (lines.get(line) ?? false) || hit);
  }
  let covered = 0;
  for (const hit of lines.values()) if (hit) covered++;
  return { covered, total: lines.size };
}

const failures = [];
const rows = [];
for (const [path, cov] of Object.entries(merged)) {
  const sTotal = Object.keys(cov.s).length;
  const sCov = Object.values(cov.s).filter((n) => n > 0).length;
  const fTotal = Object.keys(cov.f).length;
  const fCov = Object.values(cov.f).filter((n) => n > 0).length;
  const branchArr = Object.values(cov.b).flat();
  const bTotal = branchArr.length;
  const bCov = branchArr.filter((n) => n > 0).length;
  const line = lineCoverage(cov);

  const metrics = {
    statements: pct(sCov, sTotal),
    branches: pct(bCov, bTotal),
    functions: pct(fCov, fTotal),
    lines: pct(line.covered, line.total),
  };
  rows.push({ path, metrics });
  for (const [name, value] of Object.entries(metrics)) {
    if (value < THRESHOLD) {
      failures.push(path + ': ' + name + ' ' + value.toFixed(2) + '% < ' + THRESHOLD + '%');
    }
  }
}

rows.sort((a, b) => a.path.localeCompare(b.path));
for (const { path, metrics } of rows) {
  console.log(
    [
      path.replace(process.cwd() + '/', ''),
      'S' + metrics.statements.toFixed(1),
      'B' + metrics.branches.toFixed(1),
      'F' + metrics.functions.toFixed(1),
      'L' + metrics.lines.toFixed(1),
    ].join('  '),
  );
}

if (failures.length > 0) {
  console.error('\nCOVERAGE GATE FAILED (' + failures.length + '):');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(
  '\nCoverage gate passed: ' + rows.length + ' files >= ' + THRESHOLD + '% on all metrics.',
);
