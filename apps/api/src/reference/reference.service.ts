// apps/api/src/reference/reference.service.ts
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { driver, vehicle, customer, cargoType, warehouse, orderSequence } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { transportOrder, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { ReferenceListResponse } from './reference.dto.js';
import { isPgUniqueViolation } from '../common/pg-errors.js';
export interface DriverVehicleAssignmentItem {
  readonly operatorId: string;
  readonly vehicleId: string;
}
export interface DriverVehicleAssignmentsResponse {
  readonly items: readonly DriverVehicleAssignmentItem[];
}
function conflictMessage(label: string, value: string): string {
  return label + ' "' + value + '" đã tồn tại';
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
  async vehiclesAdmin(op: OperatorContext): Promise<ReferenceListResponse> {
    const rows = await this.db
      .select({ id: vehicle.vehicleId, label: vehicle.plate })
      .from(vehicle)
      .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.active, true)))
      .orderBy(asc(vehicle.plate));
    return { items: rows };
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
    const rows = await this.db
      .select({ id: customer.customerId, label: customer.name, phone: customer.phone }).from(customer)
      .where(and(eq(customer.companyId, op.companyId), eq(customer.active, true))).orderBy(asc(customer.name));
    return { items: rows.map((r) => ({ id: r.id, label: r.label, meta: { phone: r.phone } })) };
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
  // T5b/T5c: each create wraps its INSERT in a nested transaction
  // (SAVEPOINT) so a unique-violation aborts only that savepoint, leaving
  // the outer transaction usable for the reactivate UPDATE. When the
  // existing row is soft-deleted (active=false) we flip it active=true
  // and return it (UPSERT semantics matching the dispatcher mental
  // model 're-add this item'). Only when the existing row is already
  // active does the friendly localized ConflictException surface.
  async createCustomer(op: OperatorContext, name: string, phone?: string | null): Promise<{ id: string; label: string }> {
    const phoneVal = phone === undefined || phone === '' ? null : phone;
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx.insert(customer)
          .values({ ...this.tenancy(op), name, phone: phoneVal })
          .returning({ id: customer.customerId, label: customer.name });
        const row = inserted[0];
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!row) throw new Error('customer insert failed');
        return row;
      });
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        const reactivated = await this.db.update(customer)
          .set({ active: true, phone: phoneVal })
          .where(and(eq(customer.companyId, op.companyId), eq(customer.name, name), eq(customer.active, false)))
          .returning({ id: customer.customerId, label: customer.name });
        if (reactivated[0]) return reactivated[0];
        throw new ConflictException(conflictMessage('Khách hàng', name));
      }
      throw e;
    }
  }
  async updateCustomer(op: OperatorContext, id: string, name: string, phone?: string | null): Promise<void> {
    const patch = phone === undefined ? { name } : { name, phone: phone === '' ? null : phone };
    try {
      await this.db.update(customer).set(patch)
        .where(and(eq(customer.companyId, op.companyId), eq(customer.customerId, id)));
    } catch (e) {
      if (isPgUniqueViolation(e)) throw new ConflictException(conflictMessage('Khách hàng', name));
      throw e;
    }
  }
  async deleteCustomer(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(customer).set({ active: false })
      .where(and(eq(customer.companyId, op.companyId), eq(customer.customerId, id)));
  }
  async createCargoType(op: OperatorContext, name: string): Promise<{ id: string; label: string }> {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx.insert(cargoType)
          .values({ ...this.tenancy(op), name })
          .returning({ id: cargoType.cargoTypeId, label: cargoType.name });
        const row = inserted[0];
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!row) throw new Error('cargo_type insert failed');
        return row;
      });
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        const reactivated = await this.db.update(cargoType)
          .set({ active: true })
          .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.name, name), eq(cargoType.active, false)))
          .returning({ id: cargoType.cargoTypeId, label: cargoType.name });
        if (reactivated[0]) return reactivated[0];
        throw new ConflictException(conflictMessage('Tên hàng', name));
      }
      throw e;
    }
  }
  async updateCargoType(op: OperatorContext, id: string, name: string): Promise<void> {
    try {
      await this.db.update(cargoType).set({ name })
        .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.cargoTypeId, id)));
    } catch (e) {
      if (isPgUniqueViolation(e)) throw new ConflictException(conflictMessage('Tên hàng', name));
      throw e;
    }
  }
  async deleteCargoType(op: OperatorContext, id: string): Promise<void> {
    await this.db.update(cargoType).set({ active: false })
      .where(and(eq(cargoType.companyId, op.companyId), eq(cargoType.cargoTypeId, id)));
  }
  async createVehicle(op: OperatorContext, plate: string): Promise<{ id: string; label: string }> {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx.insert(vehicle)
          .values({ ...this.tenancy(op), plate })
          .returning({ id: vehicle.vehicleId, label: vehicle.plate });
        const row = inserted[0];
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!row) throw new Error('vehicle insert failed');
        return row;
      });
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        const reactivated = await this.db.update(vehicle)
          .set({ active: true })
          .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.plate, plate), eq(vehicle.active, false)))
          .returning({ id: vehicle.vehicleId, label: vehicle.plate });
        if (reactivated[0]) return reactivated[0];
        throw new ConflictException(conflictMessage('Số xe', plate));
      }
      throw e;
    }
  }
  async updateVehicle(op: OperatorContext, id: string, plate: string): Promise<void> {
    try {
      await this.db.update(vehicle).set({ plate })
        .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.vehicleId, id)));
    } catch (e) {
      if (isPgUniqueViolation(e)) throw new ConflictException(conflictMessage('Số xe', plate));
      throw e;
    }
  }
  async deleteVehicle(op: OperatorContext, id: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(vehicle).set({ active: false })
        .where(and(eq(vehicle.companyId, op.companyId), eq(vehicle.vehicleId, id)));
      await tx.update(driverVehicleAssignment)
        .set({ revokedAt: now, revocationReason: 'vehicle_soft_deleted' })
        .where(and(
          eq(driverVehicleAssignment.companyId, op.companyId),
          eq(driverVehicleAssignment.vehicleId, id),
          isNull(driverVehicleAssignment.revokedAt),
        ));
      const openOrderIds = await tx
        .select({ id: transportOrder.transportOrderId })
        .from(transportOrder)
        .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.transportOrderId, transportOrder.transportOrderId))
        .innerJoin(roadRun, eq(roadRun.roadRunId, roadRunTransportOrder.roadRunId))
        .where(and(
          eq(transportOrder.companyId, op.companyId),
          eq(roadRun.assignedAssetId, id),
          inArray(transportOrder.state, ['draft', 'assigned', 'in_transit']),
        ));
      if (openOrderIds.length > 0) {
        const ids = openOrderIds.map((r) => r.id);
        await tx.update(transportOrder)
          .set({ state: 'cancelled', cancelledAt: now, cancellationReason: 'vehicle_soft_deleted', updatedAt: now })
          .where(and(eq(transportOrder.companyId, op.companyId), inArray(transportOrder.transportOrderId, ids)));
      }
    });
  }
  async createWarehouse(op: OperatorContext, name: string, role: 'pickup' | 'delivery'): Promise<{ id: string; label: string }> {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx.insert(warehouse)
          .values({ ...this.tenancy(op), name, role })
          .returning({ id: warehouse.warehouseId, label: warehouse.name });
        const row = inserted[0];
        /* v8 ignore next -- defensive: a successful .returning() always yields a row */
        if (!row) throw new Error('warehouse insert failed');
        return row;
      });
    } catch (e) {
      if (isPgUniqueViolation(e)) {
        const reactivated = await this.db.update(warehouse)
          .set({ active: true })
          .where(and(
            eq(warehouse.companyId, op.companyId),
            eq(warehouse.name, name),
            eq(warehouse.role, role),
            eq(warehouse.active, false),
          ))
          .returning({ id: warehouse.warehouseId, label: warehouse.name });
        if (reactivated[0]) return reactivated[0];
        const label = role === 'pickup' ? 'Kho nhận hàng' : 'Kho giao hàng';
        throw new ConflictException(conflictMessage(label, name));
      }
      throw e;
    }
  }
  async updateWarehouse(op: OperatorContext, id: string, name: string): Promise<void> {
    try {
      await this.db.update(warehouse).set({ name })
        .where(and(eq(warehouse.companyId, op.companyId), eq(warehouse.warehouseId, id)));
    } catch (e) {
      if (isPgUniqueViolation(e)) throw new ConflictException(conflictMessage('Kho', name));
      throw e;
    }
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
