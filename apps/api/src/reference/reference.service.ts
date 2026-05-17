// apps/api/src/reference/reference.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle, customer, cargoType, warehouse, orderSequence } from '../database/schema/reference.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { ReferenceListResponse } from './reference.dto.js';
@Injectable()
export class ReferenceService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  async drivers(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: driver.driverId, label: driver.fullName }).from(driver)
      .where(and(eq(driver.companyId, op.companyId), eq(driver.active, true))).orderBy(asc(driver.fullName));
    return { items: rows };
  }
  async vehicles(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: vehicle.vehicleId, label: vehicle.plate }).from(vehicle)
      .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.active, true))).orderBy(asc(vehicle.plate));
    return { items: rows };
  }
  async customers(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: customer.customerId, label: customer.name }).from(customer)
      .where(and(eq(customer.companyId, op.companyId), eq(customer.active, true))).orderBy(asc(customer.name));
    return { items: rows };
  }
  async cargoTypes(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: cargoType.cargoTypeId, label: cargoType.name }).from(cargoType)
      .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.active, true))).orderBy(asc(cargoType.name));
    return { items: rows };
  }
  async peekOrderRef(op: OperatorContext, prefix: string): Promise<{ ref: string }> {
    const [row] = await this.db.select().from(orderSequence)
      .where(and(eq(orderSequence.companyId, op.companyId), eq(orderSequence.prefix, prefix)));
    const value = row?.nextValue ?? 1;
    const pad = row?.padWidth ?? 3;
    return { ref: `${prefix}.${String(value).padStart(pad, '0')}` };
  }
  async allocateOrderRef(op: OperatorContext, prefix: string): Promise<{ ref: string }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(orderSequence)
        .where(and(eq(orderSequence.companyId, op.companyId), eq(orderSequence.prefix, prefix)))
        .for('update');
      if (!row) {
        const [created] = await tx.insert(orderSequence).values({
          companyId: op.companyId, businessUnitId: op.businessUnitId,
          depotId: op.depotId, legalEntityId: op.legalEntityId,
          prefix, nextValue: 2, padWidth: 3,
        }).returning();
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!created) throw new Error('order_sequence insert failed');
        return { ref: `${prefix}.${String(1).padStart(created.padWidth, '0')}` };
      }
      const value = row.nextValue;
      await tx.update(orderSequence)
        .set({ nextValue: value + 1, updatedAt: new Date() })
        .where(eq(orderSequence.orderSequenceId, row.orderSequenceId));
      return { ref: `${prefix}.${String(value).padStart(row.padWidth, '0')}` };
    });
  }
  async warehouses(op: OperatorContext, role: 'pickup' | 'delivery'): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: warehouse.warehouseId, label: warehouse.name }).from(warehouse)
      .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.active, true), eq(warehouse.role, role)))
      .orderBy(asc(warehouse.name));
    return { items: rows };
  }
}
