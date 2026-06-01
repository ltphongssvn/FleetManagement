// apps/api/src/database/schema/index.ts
export { tenancyColumns } from './tenancy.js';
export {
  deviceRegistry,
  deviceSession,
  type DeviceRegistry,
  type NewDeviceRegistry,
  type DeviceSession,
  type NewDeviceSession,
} from './device.js';
export {
  fleetAuditLog,
  syncChangeFeed,
  outbox,
  type FleetAuditLog,
  type SyncChangeFeed,
  type Outbox,
} from './append-paths.js';
export {
  transportOrder,
  transportOrderStateEnum,
  stop,
  roadRun,
  roadRunStateEnum,
  roadRunTransportOrder,
  type TransportOrder,
  type NewTransportOrder,
  type Stop,
  type NewStop,
  type RoadRun,
  type NewRoadRun,
  type RoadRunTransportOrder,
} from './transport.js';
export {
  manifest,
  manifestRejectionReasonEnum,
  manifestStateEnum,
  uploadSession,
  uploadSessionStateEnum,
  type Manifest,
  type NewManifest,
  type UploadSession,
  type NewUploadSession,
} from './manifest.js';
export {
  erpCustomerMap,
  erpJobCodeMap,
  erpInvoiceMap,
  erpSyncDirectionEnum,
  erpSyncStatusEnum,
  type ErpCustomerMap,
  type NewErpCustomerMap,
  type ErpJobCodeMap,
  type NewErpJobCodeMap,
  type ErpInvoiceMap,
  type NewErpInvoiceMap,
} from './erp.js';
export {
  dispatchBoardProjection,
  projectionStatus,
  type DispatchBoardProjection,
  type NewDispatchBoardProjection,
  type ProjectionStatus,
  type NewProjectionStatus,
} from './projections.js';
export {
  driver,
  vehicle,
  customer,
  cargoType,
  warehouse,
  type Driver,
  type NewDriver,
  type Vehicle,
  type NewVehicle,
  type Customer,
  type NewCustomer,
  type CargoType,
  type NewCargoType,
  type Warehouse,
  type NewWarehouse,
  orderSequence,
  type OrderSequence,
  type NewOrderSequence,
} from './reference.js';

export {
  driverVehicleAssignment,
  type DriverVehicleAssignment,
  type NewDriverVehicleAssignment,
} from './driver-vehicle-assignment.js';

export {
  passkeyCredential,
  type PasskeyCredential,
  type NewPasskeyCredential,
} from './passkey-credential.js';
export {
  transportOrderExportLog,
  type TransportOrderExportLog,
  type NewTransportOrderExportLog,
} from './transport-order-export-log.js';
export {
  driverPasswordResetLog,
  type DriverPasswordResetLog,
  type NewDriverPasswordResetLog,
} from './driver-password-reset-log.js';
