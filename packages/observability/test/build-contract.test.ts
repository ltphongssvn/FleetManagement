// packages/observability/test/build-contract.test.ts
// RED test driving the GREEN fix: @fleet/observability must ship as compiled JS so
// Docker runtime (Node ESM) can resolve it without a TypeScript loader.
import { describe, it, expect } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

describe('@fleet/observability build contract', () => {
  it('declares a build script', () => {
    expect(pkg.scripts.build).toBeTruthy();
  });
  it('main field points to compiled dist/, not src/', () => {
    expect(pkg.main).toMatch(/^\.\/dist\//);
    expect(pkg.main).not.toMatch(/\.ts$/);
  });
  it('exports . default points to compiled dist/, not src/', () => {
    const def = (pkg.exports['.'] as { default: string }).default;
    expect(def).toMatch(/^\.\/dist\//);
    expect(def).not.toMatch(/\.ts$/);
  });
});
