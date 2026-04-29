// apps/api/src/auth/operator-context.factory.ts
// Derives OperatorContext from a verified JWT identity.
// Pilot scope: tenancy hierarchy uses sentinel UUID for unset claims so DB
// pollution is identifiable in audits when IDP token shape expands.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { VerifiedIdentity } from './identity-provider.interface.js';
import type { OperatorContext } from './operator-context.js';
import { IdentityExpiredError, MissingCompanyIdError, MissingOperatorIdError } from './auth.errors.js';

export const PILOT_TENANCY_SENTINEL = '00000000-0000-0000-0000-000000000000';

const UuidSchema = z.string().uuid();

@Injectable()
export class OperatorContextFactory {
  fromIdentity(identity: VerifiedIdentity): OperatorContext {
    if (!UuidSchema.safeParse(identity.operatorId).success) {
      throw new MissingOperatorIdError();
    }
    if (!UuidSchema.safeParse(identity.companyId).success) {
      throw new MissingCompanyIdError();
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (identity.expiresAt < nowSec) {
      throw new IdentityExpiredError(identity.expiresAt, nowSec);
    }
    return Object.freeze({
      operatorId: identity.operatorId,
      companyId: identity.companyId,
      businessUnitId: PILOT_TENANCY_SENTINEL,
      depotId: PILOT_TENANCY_SENTINEL,
      legalEntityId: PILOT_TENANCY_SENTINEL,
    });
  }
}
