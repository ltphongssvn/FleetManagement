-- apps/api/src/database/migrations/20260615061500_manifest_extraction_status.sql
-- EXPAND-only: phieu-can extraction lifecycle status on manifest. Mirrors the
-- repo's generated style (plain CREATE TYPE + statement-breakpoint, single
-- statement per prepared query so both the container migrator and pglite accept
-- it). Idempotency comes from drizzle's __drizzle_migrations ledger, not an
-- inline guard. Column is NOT NULL DEFAULT 'pending' so existing rows backfill.
CREATE TYPE "public"."manifest_extraction_status" AS ENUM('pending', 'extracted', 'not_found', 'unreadable', 'manual');--> statement-breakpoint
ALTER TABLE "manifest" ADD COLUMN "extraction_status" "manifest_extraction_status" DEFAULT 'pending' NOT NULL;
