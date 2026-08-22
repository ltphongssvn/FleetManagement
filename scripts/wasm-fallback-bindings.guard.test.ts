// scripts/wasm-fallback-bindings.guard.test.ts
// The wasm32 FALLBACK bindings stay out of the dependency graph.
//
// WHAT THIS CLOSES. `pnpm peers check` reported two unmet peers:
// @napi-rs/wasm-runtime@1.2.0 declares @emnapi/core and @emnapi/runtime as peers
// wanting ^2.0.0-alpha.3, while the stable 1.11.2 resolved. That is an upstream
// packaging bug -- oxc-project/oxc#21038 -- where @oxc-parser/binding-wasm32-wasi
// neither declares nor passes the peers down.
//
// THE OBVIOUS FIX WAS THE WRONG ONE. peerDependencyRules.allowedVersions would
// have silenced the warning while leaving the package installed, and would have
// kept silencing it long after upstream shipped a fix. The packages are
// WebAssembly fallbacks: napi-rs describes the target as "a portable fallback
// when no prebuilt native addon matches the host", plus browser/StackBlitz demos.
// Every host in this estate HAS a native addon -- darwin-arm64 for dev,
// linux-x64 for CI runners and Railway. The right fix is to stop installing a
// thing we cannot execute, which removes the unmet peer BY CONSTRUCTION.
//
// FIVE ENTRIES, NOT ONE. Only @oxc-parser tripped the check; @oxc-resolver,
// @rolldown, @tailwindcss and @img/sharp-wasm32 pulled versions whose peer ranges
// still resolved. Each was found by re-reading the lockfile after the previous
// removal. Fixing only the one that complains and waiting for the others to bump
// is the treadmill; the whole class goes.
//
// MEASURED: 1982 -> 1966 packages, and @emnapi/* left the graph entirely.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Both files are FILE INPUT -- parsed at the boundary, never cast.
const WorkspaceSchema = z.object({
  ignoredOptionalDependencies: z.array(z.string()),
});
const LockfileSchema = z.object({
  packages: z.record(z.string(), z.unknown()),
});

const workspace = WorkspaceSchema.parse(
  parse(readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8')),
);
const lock = LockfileSchema.parse(
  parse(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8')),
);

/** Every wasm fallback binding that must stay out of the graph. */
const IGNORED_WASM_BINDINGS = Object.freeze([
  '@oxc-parser/binding-wasm32-wasi',
  '@oxc-resolver/binding-wasm32-wasi',
  '@rolldown/binding-wasm32-wasi',
  '@tailwindcss/oxide-wasm32-wasi',
  '@img/sharp-wasm32',
] as const);

const packageNames = Object.keys(lock.packages);

describe('wasm32 fallback bindings stay out of the dependency graph', () => {
  // Vacuity guard FIRST: an empty parse would make every assertion below
  // trivially true.
  it('reads a populated lockfile', () => {
    expect(packageNames.length).toBeGreaterThan(1000);
  });

  it('every fallback binding is declared ignored', () => {
    for (const pkg of IGNORED_WASM_BINDINGS) {
      expect(workspace.ignoredOptionalDependencies).toContain(pkg);
    }
  });

  it('no fallback binding is resolved in the lockfile', () => {
    const present = packageNames.filter((p) =>
      IGNORED_WASM_BINDINGS.some((b) => p.startsWith(b + '@')),
    );
    expect(present).toEqual([]);
  });

  // The peers these bindings dragged in. Their absence is the actual proof the
  // unmet-peer warning cannot recur -- the consumer is gone, not silenced.
  it('@emnapi and @napi-rs/wasm-runtime left the graph entirely', () => {
    const orphans = packageNames.filter((p) =>
      p.startsWith('@emnapi/') || p.startsWith('@napi-rs/wasm-runtime@'),
    );
    expect(orphans).toEqual([]);
  });

  // A peerDependencyRules entry here would mean someone reached for suppression
  // instead of removal -- the exact fix this guard exists to prevent.
  // Asserted STRUCTURALLY, not by regex over the file text: the word
  // peerDependencyRules appears in the comment above the fix explaining why it
  // was rejected, and a text match cannot tell prose from configuration. That is
  // the same defect as counting comment lines instead of executable ones.
  it('no peerDependencyRules entry silences @emnapi instead of removing it', () => {
    const cfg = parse(readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8')) as {
      peerDependencyRules?: { allowedVersions?: Record<string, string> };
    };
    const keys = Object.keys(cfg.peerDependencyRules?.allowedVersions ?? {});
    expect(keys.filter((k) => k.includes('@emnapi'))).toEqual([]);
  });

  it('no wasm32 binding of any kind survives, including ones not yet listed', () => {
    const anyWasm = packageNames.filter((p) => p.includes('wasm32'));
    expect(anyWasm).toEqual([]);
  });
});
