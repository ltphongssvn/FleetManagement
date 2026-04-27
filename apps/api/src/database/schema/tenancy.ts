// apps/api/src/database/schema/tenancy.ts
// Tenancy columns reused across every multi-tenant table per Frozen Stack PDF.
// "Tenancy: company_id + business_unit_id + depot_id + legal_entity_id; no RLS"
import { uuid } from 'drizzle-orm/pg-core';

export const tenancyColumns = {
  companyId: uuid('company_id').notNull(),
  businessUnitId: uuid('business_unit_id').notNull(),
  depotId: uuid('depot_id').notNull(),
  legalEntityId: uuid('legal_entity_id').notNull(),
};
