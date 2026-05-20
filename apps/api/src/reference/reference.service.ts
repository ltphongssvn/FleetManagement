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
  async drivers(op: OperatorContext): Promise<ReferenceListResponse> {
    // operator_id is nullable in the schema; a driver without one cannot be a
    // valid roadRun.assignedOperatorId, so exclude those rows. The isNotNull
    // filter guarantees every returned operatorId is a string.
    const rows = await this.db.select({ id: driver.operatorId, label: driver.fullName }).from(driver)
      .where(and(
        eq(driver.companyId, op.companyId),
        eq(driver.active, true),
        isNotNull(driver.operatorId),
      )).orderBy(asc(driver.fullName));
    const items = rows
      .filter((r): r is { id: string; label: string } => r.id !== null)
      .map((r) => ({ id: r.id, label: r.label }));
    return { items };
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
  async warehouses(op: OperatorContext, role: 'pickup' | 'delivery'): Promise<ReferenceListResponse> {
    const rows = await this.db.select({ id: warehouse.warehouseId, label: warehouse.name }).from(warehouse)
      .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.active, true), eq(warehouse.role, role)))
      .orderBy(asc(warehouse.name));
    return { items: rows };
  }
  // --- Driver↔Vehicle active assignments ---------------------------------
  // Returns the active 1:1 pairings as { operatorId, vehicleId } for the
  // company. The dispatch form keys the driver dropdown on operator_id (not
  // driver_id) because road_run.assigned_operator_id is the canonical link
  // to the driver app. Joining via operator_id here lets the form auto-fill
  // Tài xế when Số xe is picked (and vice versa) without a second round trip.
  // Exclusions: revoked assignments, inactive driver, inactive vehicle,
  // drivers with null operator_id (cannot be used as a form value).
  // Tenancy: filters on dva.companyId AND constrains the joined driver/vehicle
  // to the same companyId (defense-in-depth — FKs do not enforce tenancy
  // consistency across joined tables; an upstream bad insert could otherwise
  // leak a foreign-company driver/vehicle into the response).
  // Order: by operator_id asc — matches the deterministic ordering convention
  // of every other reference list method (drivers/vehicles/customers/...).
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
  // --- CRUD for dispatch-form master data ---------------------------------
  // create returns the new row as a { id, label } option so the caller can
  // append it to a dropdown without a refetch. update renames in place.
  // delete is a soft delete (active=false) so transport orders that already
  // reference the row keep their label; list methods exclude inactive rows.
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
    const pad = row?.padWidth ?? 3;
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
          prefix, nextValue: 2, padWidth: 3,
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
