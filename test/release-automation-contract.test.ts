// test/release-automation-contract.test.ts
// Contract: the repo must ship a working semantic-release + Conventional
// Commits release pipeline. This test pins the *configuration shape* so a
// later edit cannot silently disable automated versioning, changelog,
// GitHub releases, or commit-message linting.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>;

describe('release automation contract', () => {
  describe('.releaserc.json (semantic-release config)', () => {
    it('exists at repo root', () => {
      expect(existsSync(resolve(root, '.releaserc.json'))).toBe(true);
    });
    it('releases from the main branch', () => {
      const cfg = json('.releaserc.json');
      expect(cfg.branches).toContain('main');
    });
    it('wires the four core plugins in order: analyzer, notes, changelog, git', () => {
      const cfg = json('.releaserc.json');
      const names = (cfg.plugins as unknown[]).map((p) =>
        Array.isArray(p) ? (p[0] as string) : (p as string),
      );
      expect(names).toEqual([
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        '@semantic-release/changelog',
        '@semantic-release/github',
        '@semantic-release/git',
      ]);
    });
    it('uses the conventionalcommits preset for analyzer + notes', () => {
      const cfg = json('.releaserc.json');
      for (const p of cfg.plugins as unknown[]) {
        if (Array.isArray(p) && /commit-analyzer|release-notes-generator/.test(p[0] as string)) {
          expect((p[1] as Record<string, unknown>).preset).toBe('conventionalcommits');
        }
      }
    });
    it('commits CHANGELOG.md and package.json via the git plugin', () => {
      const cfg = json('.releaserc.json');
      const git = (cfg.plugins as unknown[]).find(
        (p) => Array.isArray(p) && p[0] === '@semantic-release/git',
      ) as [string, Record<string, unknown>];
      expect(git[1].assets).toEqual(
        expect.arrayContaining(['CHANGELOG.md', 'package.json']),
      );
    });
  });

  describe('commitlint config (Conventional Commits enforcement)', () => {
    it('exists as commitlint.config.cjs at repo root', () => {
      expect(existsSync(resolve(root, 'commitlint.config.cjs'))).toBe(true);
    });
    it('extends @commitlint/config-conventional', () => {
      const src = read('commitlint.config.cjs');
      expect(src).toMatch(/@commitlint\/config-conventional/);
    });
  });

  describe('root package.json release wiring', () => {
    const pkg = () => json('package.json');
    it('declares a release script that runs semantic-release', () => {
      expect((pkg().scripts as Record<string, string>).release).toMatch(/semantic-release/);
    });
    it('declares a release:dry script for safe local verification', () => {
      expect((pkg().scripts as Record<string, string>)['release:dry']).toMatch(/--dry-run/);
    });
    it('has semantic-release and required plugins as devDependencies', () => {
      const dev = pkg().devDependencies as Record<string, string>;
      for (const d of [
        'semantic-release',
        '@semantic-release/changelog',
        '@semantic-release/git',
        '@commitlint/cli',
        '@commitlint/config-conventional',
      ]) {
        expect(dev, d + ' missing from devDependencies').toHaveProperty(d);
      }
    });
  });

  describe('pre-commit commit-msg hook (local Conventional Commits gate)', () => {
    it('.pre-commit-config.yaml wires commitlint on the commit-msg stage', () => {
      const src = read('.pre-commit-config.yaml');
      expect(src).toMatch(/commit-msg/);
      expect(src).toMatch(/commitlint/);
    });
  });

  describe('release CI workflow (.github/workflows/release.yml)', () => {
    it('exists', () => {
      expect(existsSync(resolve(root, '.github/workflows/release.yml'))).toBe(true);
    });
    it('triggers on push to main', () => {
      const src = read('.github/workflows/release.yml');
      expect(src).toMatch(/branches:\s*\[\s*main\s*\]/);
    });
    it('grants the permissions semantic-release needs', () => {
      const src = read('.github/workflows/release.yml');
      for (const p of ['contents: write', 'issues: write', 'pull-requests: write', 'id-token: write']) {
        expect(src, p + ' permission missing').toContain(p);
      }
    });
    it('runs the release script with GITHUB_TOKEN in env', () => {
      const src = read('.github/workflows/release.yml');
      expect(src).toMatch(/pnpm(\s+run)?\s+release/);
      expect(src).toMatch(/GITHUB_TOKEN/);
    });
  });
});
