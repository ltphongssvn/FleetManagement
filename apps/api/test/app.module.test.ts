// apps/api/test/app.module.test.ts
// Module class identity check only - importing AppModule triggers ConfigModule.forRoot
// validation. Real wiring is covered in database.module.test.ts.
import { describe, it, expect, beforeAll } from 'vitest';

describe('@fleet/api - AppModule', () => {
  beforeAll(() => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/fleet_test';
  });

  it('should be defined', async () => {
    const { AppModule } = await import('../src/app.module.js');
    expect(AppModule).toBeDefined();
  });
});
