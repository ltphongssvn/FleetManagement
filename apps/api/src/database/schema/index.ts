// apps/api/src/database/schema/index.ts
// Schema barrel — explicit named exports.
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
