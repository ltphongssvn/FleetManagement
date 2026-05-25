// apps/api/src/reference/reference.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle, customer, cargoType, warehouse, orderSequence } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { ReferenceListResponse } from './reference.dto.js';
export interface DriverVehicleAssignmentItem {
  readonly operatorId: string;
  readonly vehicleId: string;
}
export interface DriverVehicleAssignmentsResponse {
  readonly items: readonly DriverVehicleAssignmentItem[];
}
@Injectable()
export class ReferenceService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: FleetDb) {}
  private tenancy(op: OperatorContext): {
    companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
  } {
    return {
      companyId: op.companyId, businessUnitId: op.businessUnitId,
      depotId: op.depotId, legalEntityId: op.legalEntityId,
    };
  }
  // Business invariant (2026-Q2): driver and vehicle MUST be actively
  // assigned together for either to be selectable on the dispatch form.
  // Therefore drivers() and vehicles() return only entities that participate
  // in an active (not revoked) driver_vehicle_assignment whose counterpart
  // is also active and within the same tenancy. Source-of-truth filtering
  // here means the UI cannot accidentally (or maliciously) expose an
  // unpaired entity. The driverVehicleAssignments() mapping endpoint reuses
  // the same join shape so the three lists are guaranteed consistent.
  async drivers(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db
      .selectDistinct({ id: driver.operatorId, label: driver.fullName })
      .from(driver)
      .innerJoin(driverVehicleAssignment, eq(driverVehicleAssignment.driverId, driver.driverId))
      .innerJoin(vehicle, eq(driverVehicleAssignment.vehicleId, vehicle.vehicleId))
      .where(and(
        eq(driver.companyId, op.companyId),
        eq(driverVehicleAssignment.companyId, op.companyId),
        eq(vehicle.companyId, op.companyId),
        eq(driver.active, true),
        eq(vehicle.active, true),
        isNull(driverVehicleAssignment.revokedAt),
        isNotNull(driver.operatorId),
      ))
      .orderBy(asc(driver.fullName));
    const items = rows
      .filter((r): r is { id: string; label: string } => r.id !== null)
      .map((r) => ({ id: r.id, label: r.label }));
    return { items };
  }
  async vehicles(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db
      .selectDistinct({ id: vehicle.vehicleId, label: vehicle.plate })
      .from(vehicle)
      .innerJoin(driverVehicleAssignment, eq(driverVehicleAssignment.vehicleId, vehicle.vehicleId))
      .innerJoin(driver, eq(driverVehicleAssignment.driverId, driver.driverId))
      .where(and(
        eq(vehicle.companyId, op.companyId),
        eq(driverVehicleAssignment.companyId, op.companyId),
        eq(driver.companyId, op.companyId),
        eq(vehicle.active, true),
        eq(driver.active, true),
        isNull(driverVehicleAssignment.revokedAt),
        isNotNull(driver.operatorId),
      ))
      .orderBy(asc(vehicle.plate));
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
  async warehouses(op: OperatorContext, role: 'pickup' | 'delivery'): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: warehouse.warehouseId, label: warehouse.name }).from(warehouse)
      .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.active, true), eq(warehouse.role, role)))
      .orderBy(asc(warehouse.name));
    return { items: rows };
  }
  async driverVehicleAssignments(op: OperatorContext): Promise<DriverVehicleAssignmentsResponse> {
    const rows = await this.db
      .select({ operatorId: driver.operatorId, vehicleId: vehicle.vehicleId })
      .from(driverVehicleAssignment)
      .innerJoin(driver, eq(driverVehicleAssignment.driverId, driver.driverId))
      .innerJoin(vehicle, eq(driverVehicleAssignment.vehicleId, vehicle.vehicleId))
      .where(and(
        eq(driverVehicleAssignment.companyId, op.companyId),
        eq(driver.companyId, op.companyId),
        eq(vehicle.companyId, op.companyId),
        isNull(driverVehicleAssignment.revokedAt),
        eq(driver.active, true),
        eq(vehicle.active, true),
        isNotNull(driver.operatorId),
      ))
      .orderBy(asc(driver.operatorId));
    const items = rows
      .filter((r): r is { operatorId: string; vehicleId: string } => r.operatorId !== null)
      .map((r) => ({ operatorId: r.operatorId, vehicleId: r.vehicleId }));
    return { items };
  }
  async createCustomer(op: OperatorContext, name: string): Promise<{ id: string; label: string }> {
    const [row] = await this.db.insert(customer)
      .values({ ...this.tenancy(op), name }).returning({ id: customer.customerId, label: customer.name });
    /* v8 ignore next -- defensive: a successful .returning() always yields a row */
    if (!row) throw new Error('customer insert failed');
    return row;
  }
  async updateCustomer(op: OperatorContext, id: string, name: string): Promise<void> {
    await this.db.update(customer).set({ name })
      .where(and(eq(customer.companyId, op.companyId), eq(customer.customerId, id)));
  }
  async deleteCustomer(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(customer).set({ active: false })
      .where(and(eq(customer.companyId, op.companyId), eq(customer.customerId, id)));
  }
  async createCargoType(op: OperatorContext, name: string): Promise<{ id: string; label: string }> {
    const [row] = await this.db.insert(cargoType)
      .values({ ...this.tenancy(op), name }).returning({ id: cargoType.cargoTypeId, label: cargoType.name });
    /* v8 ignore next -- defensive: a successful .returning() always yields a row */
    if (!row) throw new Error('cargo_type insert failed');
    return row;
  }
  async updateCargoType(op: OperatorContext, id: string, name: string): Promise<void> {
    await this.db.update(cargoType).set({ name })
      .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.cargoTypeId, id)));
  }
  async deleteCargoType(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(cargoType).set({ active: false })
      .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.cargoTypeId, id)));
  }
  async createVehicle(op: OperatorContext, plate: string): Promise<{ id: string; label: string }> {
    const [row] = await this.db.insert(vehicle)
      .values({ ...this.tenancy(op), plate }).returning({ id: vehicle.vehicleId, label: vehicle.plate });
    /* v8 ignore next -- defensive: a successful .returning() always yields a row */
    if (!row) throw new Error('vehicle insert failed');
    return row;
  }
  async updateVehicle(op: OperatorContext, id: string, plate: string): Promise<void> {
    await this.db.update(vehicle).set({ plate })
      .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.vehicleId, id)));
  }
  async deleteVehicle(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(vehicle).set({ active: false })
      .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.vehicleId, id)));
  }
  async createWarehouse(op: OperatorContext, name: string, role: 'pickup' | 'delivery'): Promise<{ id: string; label: string }> {
    const [row] = await this.db.insert(warehouse)
      .values({ ...this.tenancy(op), name, role }).returning({ id: warehouse.warehouseId, label: warehouse.name });
    /* v8 ignore next -- defensive: a successful .returning() always yields a row */
    if (!row) throw new Error('warehouse insert failed');
    return row;
  }
  async updateWarehouse(op: OperatorContext, id: string, name: string): Promise<void> {
    await this.db.update(warehouse).set({ name })
      .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.warehouseId, id)));
  }
  async deleteWarehouse(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(warehouse).set({ active: false })
      .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.warehouseId, id)));
  }
  async peekOrderRef(op: OperatorContext, prefix: string): Promise<{ ref: string }> {
    const [row] = await this.db.select().from(orderSequence)
      .where(and(eq(orderSequence.companyId, op.companyId), eq(orderSequence.prefix, prefix)));
    const value = row?.nextValue ?? 1;
    const pad = row?.padWidth ?? 4;
    return { ref: prefix + '.' + String(value).padStart(pad, '0') };
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
          prefix, nextValue: 2, padWidth: 4,
        }).returning();
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!created) throw new Error('order_sequence insert failed');
        return { ref: prefix + '.' + String(1).padStart(created.padWidth, '0') };
      }
      const value = row.nextValue;
      await tx.update(orderSequence)
        .set({ nextValue: value + 1, updatedAt: new Date() })
        .where(eq(orderSequence.orderSequenceId, row.orderSequenceId));
      return { ref: prefix + '.' + String(value).padStart(row.padWidth, '0') };
    });
  }
}
