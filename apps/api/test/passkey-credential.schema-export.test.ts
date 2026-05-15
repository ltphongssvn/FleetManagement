// apps/api/test/passkey-credential.schema-export.test.ts
// RED: schema barrel must export passkeyCredential + its types so app.module.ts
// and database.module.ts can consume it through the schema namespace.
import { describe, it, expect } from 'vitest';
import * as schema from '../src/database/schema/index.js';

describe('schema/index.ts barrel - passkey_credential', () => {
  it('exports passkeyCredential table object', () => {
    expect(schema).toHaveProperty('passkeyCredential');
    expect(typeof schema.passkeyCredential).toBe('object');
  });
});
