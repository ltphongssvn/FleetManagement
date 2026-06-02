// e2e/teardown-cleans-hyphen-prefixed-drivers.spec.ts
import { test, expect } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import globalTeardown from './global-teardown';

test.describe.serial('global teardown removes hyphen-prefixed E2E drivers', () => {
  test('an active E2E- (hyphen) driver does not survive teardown', () => {
    const sq = String.fromCharCode(39);
    const zero = '00000000-0000-0000-0000-000000000000';
    const probe = 'E2E-T5-CANCEL-TEARDOWN-' + String(Date.now());
    const opId = '00000000-0000-0000-0000-0000000000dd';
    const insert =
      'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name, phone, password_hash, operator_id, active) VALUES (' +
      'gen_random_uuid(), ' +
      sq + zero + sq + ', ' + sq + zero + sq + ', ' + sq + zero + sq + ', ' + sq + zero + sq + ', ' +
      sq + probe + sq + ', ' + sq + '09' + String(Date.now()).slice(-8) + sq + ', ' +
      sq + 'x' + sq + ', ' + sq + opId + sq + ', true);';
    const ins = dockerPsql(insert);
    if (ins.failed) throw new Error('seed insert failed: ' + ins.stderr);

    globalTeardown();

    const remainingSql =
      'SELECT count(*) FROM driver WHERE full_name = ' + sq + probe + sq + ' AND active=true;';
    const remaining = parseInt(dockerPsql(remainingSql).stdout.trim(), 10);

    const cleanup = dockerPsql('DELETE FROM driver WHERE full_name = ' + sq + probe + sq + ';');
    if (cleanup.failed) throw new Error('cleanup failed: ' + cleanup.stderr);

    expect(remaining).toBe(0);
  });
});
