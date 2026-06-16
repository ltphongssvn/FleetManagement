-- apps/api/src/database/migrations/20260615071500_manifest_extraction_reason.sql
-- EXPAND-only: deterministic failure cause for non-extracted phieu-can outcomes.
-- Mirrors 20260615061500's generated style (plain CREATE TYPE + statement-
-- breakpoint, one statement per prepared query for both the container migrator
-- and pglite). Column is NULLABLE (no default): only not_found/unreadable rows
-- set it; pending/extracted/manual stay null. Idempotency via drizzle's
-- __drizzle_migrations ledger, not an inline guard.
CREATE TYPE "public"."manifest_extraction_reason" AS ENUM('unparseable', 'below_sanity_min', 'above_sanity_max', 'no_field', 'object_missing');--> statement-breakpoint
ALTER TABLE "manifest" ADD COLUMN "extraction_reason" "manifest_extraction_reason";
