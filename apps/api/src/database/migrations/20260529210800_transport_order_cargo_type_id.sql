-- apps/api/src/database/migrations/20260529210800_transport_order_cargo_type_id.sql
ALTER TABLE transport_order ADD COLUMN IF NOT EXISTS cargo_type_id uuid;
