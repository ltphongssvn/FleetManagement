// apps/api/test/app.module.test.ts
// Smoke test: AppModule is constructible. Replaces the empty-tests-fail-vitest gap
// until real controllers/services exist (per day-one plan, week 3+).
import { describe, it, expect } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('@fleet/api — AppModule', () => {
  it('should be defined', () => {
    expect(AppModule).toBeDefined();
  });

  it('should be a class (NestJS module)', () => {
    expect(typeof AppModule).toBe('function');
  });
});
