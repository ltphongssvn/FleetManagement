// apps/ops-web/test/metadata.test.ts
// Contract test: root layout exports valid Next.js metadata.
import { describe, it, expect } from 'vitest';
import { metadata } from '@/app/layout';

describe('@fleet/ops-web - root metadata', () => {
  it('declares a title', () => {
    expect(metadata.title).toBeTruthy();
  });
  it('declares a description', () => {
    expect(metadata.description).toBeTruthy();
  });
});
