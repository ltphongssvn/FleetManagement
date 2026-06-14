-- apps/api/src/database/migrations/20260612124725_manifest_extracted_net_weight_kg.sql
-- EXPAND-only: nullable kg column for phieu-can net-weight extraction.
ALTER TABLE manifest ADD COLUMN IF NOT EXISTS extracted_net_weight_kg numeric(12,3);
