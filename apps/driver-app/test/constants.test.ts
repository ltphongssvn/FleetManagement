// apps/driver-app/test/constants.test.ts
// TDD: verify constants module is wired correctly.
import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/constants.js';

describe('@fleet/driver-app — constants', () => {
  it('should export APP_VERSION', () => {
    expect(APP_VERSION).toBeDefined();
  });

  it('should follow semver-like format', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
