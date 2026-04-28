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
