// apps/driver-app/test/compose-config.test.ts
// TDD RED: driver-app service must be present in compose.yaml.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('compose.yaml driver-app service', () => {
  const compose = readFileSync(resolve(__dirname, '../../../compose.yaml'), 'utf8');

  it('defines driver-app service', () => {
    expect(compose).toMatch(/^\s{2}driver-app:/m);
  });

  it('builds from apps/driver-app Dockerfile', () => {
    expect(compose).toMatch(/context:\s*\.\s*\n\s*dockerfile:\s*apps\/driver-app\/Dockerfile/);
  });

  it('exposes port 8081', () => {
    expect(compose).toMatch(/8081:8081/);
  });

  it('depends on api service', () => {
    const driverBlock = compose.match(/^\s{2}driver-app:[\s\S]*?(?=^\s{0,2}\S|\Z)/m)?.[0] ?? '';
    expect(driverBlock).toMatch(/depends_on:[\s\S]*?api:/);
  });
});
