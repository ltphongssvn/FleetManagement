-- apps/api/src/database/migrations/20260523181135_transport_order_cancellation_audit.sql
-- T5 (2026): cancellation audit columns on transport_order.
--
-- Adds the four soft-state-transition audit fields and a DB-level check
-- constraint that makes a 'cancelled' state without cancelled_at impossible
-- even if the service layer is bypassed. Mirrors the defense-in-depth
-- philosophy of 0011_road_run_pair_not_null.sql: the deepest layer is the
-- last line of defense behind DTO + service guards.
--
-- All four columns are nullable because:
--   * a draft/assigned/in_transit/completed order has no cancellation data;
--   * making them NOT NULL with defaults would lie about the audit trail.
-- The check constraint enforces the real invariant: state='cancelled'
-- requires cancelled_at to be present.
ALTER TABLE transport_order
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS cancellation_note varchar(500) NULL;
--> statement-breakpoint
ALTER TABLE transport_order
  ADD CONSTRAINT transport_order_cancelled_audit_consistent
  CHECK (state <> 'cancelled' OR cancelled_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transport_order_cancelled_at_idx
  ON transport_order (cancelled_at)
  WHERE cancelled_at IS NOT NULL;
