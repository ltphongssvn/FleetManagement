// apps/api/src/transport-orders/transport-orders.service.ts
// Pilot seed: creates transport_order + stops + road_run, plus 3 append
// paths so the dispatch_board projection picks it up.
//
// Driver-vehicle pair guard: when a road_run is supplied with both
// assignedOperatorId AND assignedAssetId, the service requires an active
// (non-revoked) driver_vehicle_assignment row in the calling company that
// binds the driver (by operator_id -> driver_id) to the vehicle.
//
// Auto-numbering (T3, 2026): the dispatcher never inputs So Lenh. The
// service allocates external_ref atomically via OrderNumberingService
// (SELECT ... FOR UPDATE on order_sequence) so two parallel creates within
// the same company cannot collide. Any input.externalRef is ignored -- the
// server is authoritative.
//
// Driver reads (2026 status partition): the driver 'Xem Lenh Dieu Xe' surface
// is split the same way the ops-web board is. listAssigned() returns ONLY
// active (non-terminal) road runs so completed runs stop polluting the live
// list; listCompleted() is the paginated + searchable archive of completed
// runs (offset pagination, newest-first, optional ILIKE search over customer
// name), returning the SSOT DriverCompletedPageResponse envelope. Both, plus
// findById and tripHistory, share ONE row-building query (buildDriverRows) so
// the row shape + enrichment can never diverge across the driver reads; each
// caller passes its own state slice / ordering / paging. The active/finished
// partition derives from the SSOT statesForStatusGroup (never hardcoded here).
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import { eq, and, asc, desc, isNull, inArray, ilike, count, type SQL } from 'drizzle-orm';
import type { FleetDb } from '../database/database.module.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { transportOrder, stop, roadRun, roadRunTransportOrder } from '../database/schema/transport.js';
import { vehicle, customer, cargoType, warehouse, driver } from '../database/schema/reference.js';
import { driverVehicleAssignment } from '../database/schema/driver-vehicle-assignment.js';
import { manifest } from '../database/schema/manifest.js';
import { appendTriWrite } from '../database/append-tri-write.js';
import type { OperatorContext } from '../auth/operator-context.js';
import type { CreateTransportOrderInput, CreateTransportOrderResponse, ListAssignedResponse, ListAssignedRow, TripHistoryResponse } from './transport-orders.dto.js';
import { DriverVehicleAssignmentRequiredError, TransportOrderNotFoundError } from './transport-orders.errors.js';
import { OrderNumberingService } from './order-numbering.service.js';
import { groupCompletedTripsByMonth, MANIFEST_PHOTO_RECEIVED_STATES } from '@fleet/domain';
import { OUTBOX_QUEUES, statesForStatusGroup } from '@fleet/sync-protocol';
import type { DriverCompletedPageQuery, DriverCompletedPageResponse, RoadRunStateName } from '@fleet/sync-protocol';

// The active (non-terminal) road-run states, from the SSOT partition. Used to
// filter listAssigned so completed/cancelled runs never appear in the live list.
const ACTIVE_ROAD_RUN_STATES: readonly RoadRunStateName[] = [...statesForStatusGroup('active')];

// Options for the shared driver-row query. Every field is optional so each
// public caller composes exactly the slice it needs:
//   - states: restrict to these road-run states (listAssigned=active,
//     listCompleted/tripHistory=['completed']); omit for ALL states (findById).
//   - transportOrderId: resolve a single order by id (findById), across states.
//   - search: case-insensitive ILIKE over customer name (listCompleted).
//   - orderByCompletedDesc: newest-completed-first (listCompleted); default is
//     asc(plannedStartAt) as the live list has always used.
//   - limit/offset: offset pagination (listCompleted); omit for unbounded.
interface DriverRowsOptions {
  readonly states?: readonly RoadRunStateName[];
  readonly transportOrderId?: string;
  readonly search?: string;
  readonly orderByCompletedDesc?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

@Injectable()
export class TransportOrdersService {
  // numbering is optional at the constructor level for source-compatibility
  // with tests that instantiated TransportOrdersService(db) before T3.
  // Nest DI always provides it in production; defaults to a fresh instance
  // when omitted so the create() path can always allocate XTT.MM-NNN.
  private readonly numbering: OrderNumberingService;
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: FleetDb,
    numbering?: OrderNumberingService,
  ) {
    this.numbering = numbering ?? new OrderNumberingService();
  }
  async create(input: CreateTransportOrderInput, op: OperatorContext): Promise<CreateTransportOrderResponse> {
    return this.db.transaction(async (tx) => {
      const tenancy = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };
      const [pair] = await tx.select({ assignmentId: driverVehicleAssignment.assignmentId })
        .from(driverVehicleAssignment)
        .innerJoin(driver, eq(driverVehicleAssignment.driverId, driver.driverId))
        .where(and(
          eq(driverVehicleAssignment.companyId, op.companyId),
          eq(driver.companyId, op.companyId),
          eq(driver.operatorId, input.roadRun.assignedOperatorId),
          eq(driverVehicleAssignment.vehicleId, input.roadRun.assignedAssetId),
          isNull(driverVehicleAssignment.revokedAt),
        ))
        .limit(1);
      if (!pair) throw new DriverVehicleAssignmentRequiredError();
      // Server-assigned external_ref (So Lenh). Client input is ignored.
      const externalRef = await this.numbering.allocate(tx, op);
      const [created] = await tx.insert(transportOrder).values({
        ...tenancy,
        externalRef,
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.cargoTypeId !== undefined ? { cargoTypeId: input.cargoTypeId } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      }).returning();
      if (!created) throw new Error('transport_order insert failed');
      const transportOrderId = created.transportOrderId;
      for (const s of input.stops) {
        await tx.insert(stop).values({
          ...tenancy,
          transportOrderId,
          sequence: s.sequence,
          stopType: s.stopType,
          ...(s.yardId !== undefined ? { yardId: s.yardId } : {}),
          ...(s.plannedAt !== undefined ? { plannedAt: new Date(s.plannedAt) } : {}),
        });
      }
      const [rr] = await tx.insert(roadRun).values({
        ...tenancy,
        assignedOperatorId: input.roadRun.assignedOperatorId,
        assignedAssetId: input.roadRun.assignedAssetId,
        ...(input.roadRun.plannedStartAt !== undefined ? { plannedStartAt: new Date(input.roadRun.plannedStartAt) } : {}),
      }).returning();
      if (!rr) throw new Error('road_run insert failed');
      const roadRunId = rr.roadRunId;
      await tx.insert(roadRunTransportOrder).values({
        ...tenancy,
        roadRunId,
        transportOrderId,
        sequence: 1,
      });
      const serverSeq = await allocateServerSeq(tx);
      await appendTriWrite(tx, {
        serverSeq,
        actionId: randomUUID(),
        aggregateType: 'road_run',
        aggregateId: roadRunId,
        delta: {
          state: 'planned',
          assignedOperatorId: input.roadRun.assignedOperatorId,
          assignedAssetId: input.roadRun.assignedAssetId,
          plannedStartAt: input.roadRun.plannedStartAt ?? null,
          stopCount: input.stops.length,
          transportOrderRefs: [externalRef],
        },
        eventType: 'road_run.created',
        auditPayload: { transportOrderId, externalRef },
        operatorId: op.operatorId,
        queueName: OUTBOX_QUEUES.PROJECTIONS,
        outboxPayload: { aggregateType: 'road_run', eventType: 'road_run.created', roadRunId, externalRef },
        op,
      });
      return { transportOrderId, roadRunId, externalRef };
    });
  }

  async findById(id: string, op: OperatorContext): Promise<ListAssignedRow> {
    const [orderRow] = await this.db
      .select({ transportOrderId: transportOrder.transportOrderId })
      .from(transportOrder)
      .where(and(
        eq(transportOrder.transportOrderId, id),
        eq(transportOrder.companyId, op.companyId),
      ))
      .limit(1);
    if (orderRow === undefined) throw new TransportOrderNotFoundError();
    // Resolve the row across ALL states (a completed order must still be
    // reviewable), operator-scoped, by id -- via the shared row builder.
    const rows = await this.buildDriverRows(op, { transportOrderId: id });
    const found = rows.find((r) => r.transportOrderId === id);
    if (found === undefined) throw new TransportOrderNotFoundError();
    return found;
  }
  // T5 (2026): company-scoped lookup that accepts either a transport_order
  // UUID or the human-readable XTT.MM-NNN external_ref. Unlike findById +
  // listAssigned (which filter by assignedOperatorId), this method is
  // scoped only by companyId, so a dispatcher can resolve any order in
  // the company regardless of which driver the road_run was assigned to.
  // Single-company deployment assumption per Frozen Stack: companyId is
  // the only tenancy boundary.
  async findByCompanyIdOrRef(idOrRef: string, op: OperatorContext): Promise<ListAssignedRow> {
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrRef);
    const matchCondition = looksLikeUuid
      ? eq(transportOrder.transportOrderId, idOrRef)
      : eq(transportOrder.externalRef, idOrRef);
    const rows = await this.db
      .select({
        transportOrderId: transportOrder.transportOrderId,
        externalRef: transportOrder.externalRef,
        roadRunId: roadRun.roadRunId,
        state: roadRun.state,
        plannedStartAt: roadRun.plannedStartAt,
        createdAt: transportOrder.createdAt,
        startedAt: roadRun.startedAt,
        completedAt: roadRun.completedAt,
        plate: vehicle.plate,
        customerName: customer.name,
        cargoName: cargoType.name,
        driverName: driver.fullName,
      })
      .from(roadRun)
      .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
      .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
      .leftJoin(vehicle, eq(vehicle.vehicleId, roadRun.assignedAssetId))
      .leftJoin(customer, eq(customer.customerId, transportOrder.customerId))
      .leftJoin(cargoType, eq(cargoType.cargoTypeId, transportOrder.cargoTypeId))
      .leftJoin(driver, and(eq(driver.operatorId, roadRun.assignedOperatorId), eq(driver.companyId, op.companyId)))
      .where(and(
        eq(roadRun.companyId, op.companyId),
        matchCondition,
      ))
      .limit(1);
    const head = rows[0];
    if (head === undefined) throw new TransportOrderNotFoundError();
    const stopRows = await this.db
      .select({
        transportOrderId: stop.transportOrderId,
        stopId: stop.stopId,
        sequence: stop.sequence,
        stopType: stop.stopType,
        plannedAt: stop.plannedAt,
        warehouseName: warehouse.name,
        arrivedAt: stop.arrivedAt,
        departedAt: stop.departedAt,
      })
      .from(stop)
      .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
      .where(and(
        eq(stop.companyId, op.companyId),
        eq(stop.transportOrderId, head.transportOrderId),
      ))
      .orderBy(asc(stop.sequence));
    const proofStopIds = await this.computeStopsWithProof(op, [head.transportOrderId]);
    const stops = stopRows.map((s) => ({
      sequence: s.sequence,
      stopType: s.stopType,
      plannedAt: s.plannedAt ? s.plannedAt.toISOString() : null,
      warehouseName: s.warehouseName,
      arrivedAt: s.arrivedAt ? s.arrivedAt.toISOString() : null,
      departedAt: s.departedAt ? s.departedAt.toISOString() : null,
      hasManifest: proofStopIds.has(s.stopId),
    }));
    const pickupName = stops.find((x) => x.stopType.toLowerCase() === 'pickup')?.warehouseName ?? null;
    const drops = stops.filter((x) => {
      const t = x.stopType.toLowerCase();
      return t === 'delivery' || t === 'dropoff';
    });
    const deliveryName = drops[drops.length - 1]?.warehouseName ?? null;
    const cancelMap = await this.computeCancelEligibility(op, [head.transportOrderId]);
    const cancelInfo = cancelMap.get(head.transportOrderId) ?? { canCancel: true, cancelBlockedReason: null };
    return {
      transportOrderId: head.transportOrderId,
      externalRef: head.externalRef,
      orderRef: head.externalRef,
      roadRunId: head.roadRunId,
      state: head.state,
      plannedStartAt: head.plannedStartAt ? head.plannedStartAt.toISOString() : null,
      createdAt: head.createdAt.toISOString(),
      startedAt: head.startedAt ? head.startedAt.toISOString() : null,
      completedAt: head.completedAt ? head.completedAt.toISOString() : null,
      plate: head.plate,
      customerName: head.customerName,
      cargoName: head.cargoName,
      driverName: head.driverName,
      pickupName,
      deliveryName,
      canCancel: cancelInfo.canCancel,
      cancelBlockedReason: cancelInfo.cancelBlockedReason,
      stops,
    };
  }

  // Single source of truth for the cancel affordance surfaced on read models.
  // Mirrors the TransportOrdersCancelService guard: an order whose manifest set
  // includes any RECEIVED photo (state in MANIFEST_PHOTO_RECEIVED_STATES) can no
  // longer be cancelled. Returns a map orderId -> { canCancel, cancelBlockedReason }
  // so a caller enriching N rows issues ONE grouped query, not N. Orders with no
  // received photo are absent from the map and default to cancellable.
  private async computeCancelEligibility(
    op: OperatorContext,
    transportOrderIds: readonly string[],
  ): Promise<Map<string, { canCancel: boolean; cancelBlockedReason: string | null }>> {
    const result = new Map<string, { canCancel: boolean; cancelBlockedReason: string | null }>();
    if (transportOrderIds.length === 0) return result;
    const rows = await this.db
      .select({ transportOrderId: manifest.transportOrderId, n: count() })
      .from(manifest)
      .where(and(
        eq(manifest.companyId, op.companyId),
        inArray(manifest.transportOrderId, [...transportOrderIds]),
        inArray(manifest.state, [...MANIFEST_PHOTO_RECEIVED_STATES]),
      ))
      .groupBy(manifest.transportOrderId);
    // Every returned row is a group that MATCHED the received-state filter, so
    // its count is >= 1 by construction (no defensive n > 0 branch needed --
    // that branch would be unreachable and uncoverable).
    for (const r of rows) {
      result.set(r.transportOrderId, { canCancel: false, cancelBlockedReason: 'photos_received' });
    }
    return result;
  }
  // Per-stop committed-proof signal for the delivery-capture gate. Returns
  // the set of stopIds with at least one manifest in a photo-received state
  // (same threshold the cancel-lock trusts). ONE grouped query for N orders,
  // mirroring computeCancelEligibility. A stop absent from the set has no
  // committed proof photo yet.
  private async computeStopsWithProof(
    op: OperatorContext,
    transportOrderIds: readonly string[],
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (transportOrderIds.length === 0) return result;
    const rows = await this.db
      .select({ stopId: manifest.stopId })
      .from(manifest)
      .where(and(
        eq(manifest.companyId, op.companyId),
        inArray(manifest.transportOrderId, [...transportOrderIds]),
        inArray(manifest.state, [...MANIFEST_PHOTO_RECEIVED_STATES]),
      ))
      .groupBy(manifest.stopId);
    for (const r of rows) {
      if (r.stopId !== null) result.add(r.stopId);
    }
    return result;
  }
  // Shared driver-row builder: the ONE query + enrichment behind listAssigned,
  // listCompleted, findById and tripHistory. Always operator-scoped +
  // company-scoped; the caller narrows by state / single-id / search, chooses
  // ordering, and optionally pages. Returns fully-enriched ListAssignedRow[].
  private async buildDriverRows(op: OperatorContext, opts: DriverRowsOptions): Promise<ListAssignedRow[]> {
    const conditions: SQL[] = [
      eq(roadRun.companyId, op.companyId),
      eq(roadRun.assignedOperatorId, op.operatorId),
    ];
    if (opts.states !== undefined) conditions.push(inArray(roadRun.state, [...opts.states]));
    if (opts.transportOrderId !== undefined) conditions.push(eq(transportOrder.transportOrderId, opts.transportOrderId));
    if (opts.search !== undefined) conditions.push(ilike(customer.name, '%' + opts.search + '%'));
    const orderByClause = opts.orderByCompletedDesc === true ? desc(roadRun.completedAt) : asc(roadRun.plannedStartAt);
    const base = this.db
      .select({
        transportOrderId: transportOrder.transportOrderId,
        externalRef: transportOrder.externalRef,
        roadRunId: roadRun.roadRunId,
        state: roadRun.state,
        plannedStartAt: roadRun.plannedStartAt,
        createdAt: transportOrder.createdAt,
        startedAt: roadRun.startedAt,
        completedAt: roadRun.completedAt,
        plate: vehicle.plate,
        customerName: customer.name,
      })
      .from(roadRun)
      .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
      .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
      .leftJoin(vehicle, eq(vehicle.vehicleId, roadRun.assignedAssetId))
      .leftJoin(customer, eq(customer.customerId, transportOrder.customerId))
      .where(and(...conditions))
      .orderBy(orderByClause);
    const rows = opts.limit !== undefined
      ? await base.limit(opts.limit).offset(opts.offset ?? 0)
      : await base;
    const transportOrderIds = rows.map((r) => r.transportOrderId);
    const stopRows = transportOrderIds.length === 0
      ? []
      : await this.db
          .select({
            transportOrderId: stop.transportOrderId,
            stopId: stop.stopId,
            sequence: stop.sequence,
            stopType: stop.stopType,
            plannedAt: stop.plannedAt,
            warehouseName: warehouse.name,
            arrivedAt: stop.arrivedAt,
            departedAt: stop.departedAt,
          })
          .from(stop)
          .leftJoin(warehouse, eq(warehouse.warehouseId, stop.yardId))
          .where(and(
            eq(stop.companyId, op.companyId),
            inArray(stop.transportOrderId, transportOrderIds),
          ))
          .orderBy(asc(stop.sequence));
    interface StopRow {
      stopId: string;
      sequence: number;
      stopType: string;
      plannedAt: Date | null;
      warehouseName: string | null;
      arrivedAt: Date | null;
      departedAt: Date | null;
    }
    const stopsByOrder = new Map<string, StopRow[]>();
    for (const sr of stopRows) {
      const list = stopsByOrder.get(sr.transportOrderId) ?? [];
      list.push({
        stopId: sr.stopId,
        sequence: sr.sequence,
        stopType: sr.stopType,
        plannedAt: sr.plannedAt,
        warehouseName: sr.warehouseName,
        arrivedAt: sr.arrivedAt,
        departedAt: sr.departedAt,
      });
      stopsByOrder.set(sr.transportOrderId, list);
    }
    const pickupNameOf = (stops: readonly StopRow[]): string | null => {
      const s = stops.find((x) => x.stopType.toLowerCase() === 'pickup');
      return s?.warehouseName ?? null;
    };
    const deliveryNameOf = (stops: readonly StopRow[]): string | null => {
      const drops = stops.filter((x) => {
        const t = x.stopType.toLowerCase();
        return t === 'delivery' || t === 'dropoff';
      });
      const last = drops[drops.length - 1];
      return last?.warehouseName ?? null;
    };
    const cancelMap = await this.computeCancelEligibility(op, transportOrderIds);
    const proofStopIds = await this.computeStopsWithProof(op, transportOrderIds);
    return rows.map((r) => {
      const stops = stopsByOrder.get(r.transportOrderId) ?? [];
      return {
        transportOrderId: r.transportOrderId,
        externalRef: r.externalRef,
        orderRef: r.externalRef,
        roadRunId: r.roadRunId,
        state: r.state,
        plannedStartAt: r.plannedStartAt ? r.plannedStartAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        plate: r.plate,
        customerName: r.customerName,
        cargoName: null,
        driverName: null,
        pickupName: pickupNameOf(stops),
        deliveryName: deliveryNameOf(stops),
        canCancel: (cancelMap.get(r.transportOrderId) ?? { canCancel: true }).canCancel,
        cancelBlockedReason: (cancelMap.get(r.transportOrderId) ?? { cancelBlockedReason: null }).cancelBlockedReason,
        stops: stops.map((s) => ({
          sequence: s.sequence,
          stopType: s.stopType,
          plannedAt: s.plannedAt ? s.plannedAt.toISOString() : null,
          warehouseName: s.warehouseName,
          arrivedAt: s.arrivedAt ? s.arrivedAt.toISOString() : null,
          departedAt: s.departedAt ? s.departedAt.toISOString() : null,
          hasManifest: proofStopIds.has(s.stopId),
        })),
      };
    });
  }

  // Active (non-terminal) assignments for the calling driver. Completed +
  // cancelled runs are excluded so they stop polluting the live list; they
  // live in listCompleted (paginated archive) instead.
  async listAssigned(op: OperatorContext): Promise<ListAssignedResponse> {
    const rows = await this.buildDriverRows(op, { states: ACTIVE_ROAD_RUN_STATES });
    return { rows };
  }

  // Paginated + searchable archive of the calling driver's COMPLETED runs.
  // Offset pagination (newest-completed first) + optional ILIKE search over
  // customer name. Returns the SSOT DriverCompletedPageResponse envelope
  // (data + page/pageSize/total/totalPages/hasMore); never paginated without a
  // total (2026 UX rule). Mirrors the ops-web board's offset pagination so the
  // wire contract is shared across the two surfaces.
  async listCompleted(op: OperatorContext, query: DriverCompletedPageQuery): Promise<DriverCompletedPageResponse> {
    const { page, pageSize, search } = query;
    const countConditions: SQL[] = [
      eq(roadRun.companyId, op.companyId),
      eq(roadRun.assignedOperatorId, op.operatorId),
      inArray(roadRun.state, ['completed']),
    ];
    if (search !== undefined) countConditions.push(ilike(customer.name, '%' + search + '%'));
    const totalRows = await this.db
      .select({ value: count() })
      .from(roadRun)
      .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
      .innerJoin(transportOrder, eq(transportOrder.transportOrderId, roadRunTransportOrder.transportOrderId))
      .leftJoin(customer, eq(customer.customerId, transportOrder.customerId))
      .where(and(...countConditions));
    const total = totalRows[0]?.value ?? 0;
    const data = await this.buildDriverRows(op, {
      states: ['completed'],
      ...(search !== undefined ? { search } : {}),
      orderByCompletedDesc: true,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    return { data, page, pageSize, total, totalPages, hasMore: page < totalPages };
  }

  async tripHistory(op: OperatorContext): Promise<TripHistoryResponse> {
    // Completed runs for the calling operator, via the shared builder (NOT
    // listAssigned, which is now active-only). Grouped by VN month downstream.
    const completedRows = await this.buildDriverRows(op, { states: ['completed'] });
    const groups = groupCompletedTripsByMonth(
      completedRows,
      (r) => r.state,
      (r) => r.completedAt,
    );
    return {
      months: groups.map((g) => ({
        monthKey: g.monthKey,
        label: g.label,
        count: g.count,
        trips: g.trips,
      })),
    };
  }
}
