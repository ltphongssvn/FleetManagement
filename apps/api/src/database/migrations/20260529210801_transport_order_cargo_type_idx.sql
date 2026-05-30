-- apps/api/src/database/migrations/20260529210801_transport_order_cargo_type_idx.sql
CREATE INDEX IF NOT EXISTS transport_order_cargo_type_idx ON transport_order (cargo_type_id);
