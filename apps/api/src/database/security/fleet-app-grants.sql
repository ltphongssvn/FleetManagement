-- apps/api/src/database/security/fleet-app-grants.sql
-- Layer-1 least-privilege RUNTIME role privilege contract (the no-DELETE role).
--
-- SINGLE SOURCE OF TRUTH for what the runtime application role (:role) may do.
-- Applied verbatim in the ephemeral-Postgres validation test AND against production,
-- so the tested privilege boundary IS the deployed one.
--
-- The :role token is substituted with the concrete role name by the caller (the test
-- and the production runbook). The role is assumed to already exist (created with
-- LOGIN + a password, which differs test-vs-prod and is therefore NOT in this file).
--
-- DESIGN (2026 least-privilege, web-grounded):
--   * READ  via the predefined role pg_read_all_data (cluster-wide SELECT + implicit
--     USAGE on all tables/views/sequences) — avoids brittle per-schema SELECT grants.
--   * WRITE via EXPLICIT INSERT, UPDATE only. We deliberately do NOT grant
--     pg_write_all_data, because that predefined role ALSO bundles DELETE and TRUNCATE,
--     which would defeat the no-DELETE business rule. DELETE/TRUNCATE/DROP/ALTER are
--     never granted, so the role cannot destroy data even if its token is compromised.
--   * Removal is soft-delete (an UPDATE of deleted_at), which this role CAN do.
--   * Future tables created by the migration/owner role auto-grant the same to :role
--     via ALTER DEFAULT PRIVILEGES, so DB_AUTO_MIGRATE does not silently lock the
--     runtime role out of new tables. (FOR ROLE must name the object-CREATING role;
--     in production that is the migration/owner role, e.g. postgres.)

-- Read: cluster-wide SELECT (+ implicit schema/sequence USAGE) without per-schema grants.
GRANT pg_read_all_data TO :role;

-- Connect/USAGE on the schema (belt-and-suspenders for the write path).
GRANT USAGE ON SCHEMA public TO :role;

-- Write: EXPLICIT INSERT + UPDATE on every existing table. NO DELETE, NO TRUNCATE.
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO :role;

-- Sequences: USAGE + SELECT so INSERTs into serial/identity columns can draw nextval.
-- (Most PKs here are uuid defaultRandom(), but this keeps serial-keyed tables working.)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :role;

-- Future tables/sequences created by the migration/owner role auto-grant to :role.
-- NOTE: in the ephemeral test the objects are owned by the test superuser, so FOR ROLE
-- is omitted there (defaults apply to objects the CURRENT role creates). The production
-- runbook uses ALTER DEFAULT PRIVILEGES FOR ROLE <migration_owner> ... explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE ON TABLES TO :role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :role;
