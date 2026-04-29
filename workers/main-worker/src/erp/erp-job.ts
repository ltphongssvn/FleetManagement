// workers/main-worker/src/erp/erp-job.ts
// Worker-side re-export of the ERP queue wire contract owned by @fleet/sync-protocol.
// Frozen Stack PDF: "@sync-protocol — wire types". Co-locating the schema in the
// shared package prevents API/worker drift on the BullMQ payload shape.
export {
  ErpJobDataWireSchema as ErpJobDataSchema,
  ErpInvoicePayloadWireSchema as ErpInvoicePayloadSchema,
  ErpMappingContextWireSchema as ErpMappingContextSchema,
  type ErpJobDataWire as ErpJobData,
} from '@fleet/sync-protocol';
