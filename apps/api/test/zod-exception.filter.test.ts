// apps/api/test/zod-exception.filter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z, type ZodError } from 'zod';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter.js';

describe('@fleet/api - ZodExceptionFilter', () => {
  it('maps ZodError to 400 BadRequest with structured issues', () => {
    const filter = new ZodExceptionFilter();
    let parsedError: ZodError;
    try {
      z.object({ name: z.string() }).parse({ name: 123 });
      throw new Error('should not reach');
    } catch (e) {
      parsedError = e as ZodError;
    }

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const response = { status, json };
    const switchToHttp = vi.fn().mockReturnValue({ getResponse: () => response });
    const host = { switchToHttp } as never;

    filter.catch(parsedError, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
        issues: expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
      }),
    );
  });
});
