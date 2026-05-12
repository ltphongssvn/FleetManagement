// apps/api/test/admin-drivers-list.service.test.ts
import { describe, it, expect } from 'vitest';
import { AdminDriversListService } from '../src/admin/admin-drivers-list.service.js';

describe('AdminDriversListService', () => {
  it('module exports class with list method', () => {
    expect(typeof AdminDriversListService).toBe('function');
    expect(typeof AdminDriversListService.prototype.list).toBe('function');
  });
});
