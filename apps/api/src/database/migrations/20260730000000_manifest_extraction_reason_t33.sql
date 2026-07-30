-- apps/api/src/database/migrations/20260730000000_manifest_extraction_reason_t33.sql
-- T33: widen manifest_extraction_reason to the two cannot-recognize causes added
-- to the @fleet/sync-protocol EXTRACTION_FAILURE_REASONS vocabulary in Slice B
-- (multiple_slips, non_standard_format). Slice B widened the Zod SSOT + the
-- pgEnum DECLARATION but shipped NO migration, so migration-based databases (CI
-- + Railway) kept the original 5-value type and every not_found/unreadable result
-- carrying a new reason threw invalid-input-value-for-enum -> 500. The e2e apex
-- caught this real production defect; fresh-from-schema dev DBs masked it.
--
-- DROP/RECREATE (not ALTER TYPE ADD VALUE): this repo migrator (container Postgres
-- AND pglite) wraps each migration file in a transaction, and Postgres forbids
-- REFERENCING a value added by ALTER TYPE ADD VALUE in the same transaction
-- (drizzle-orm#3466; the -unsafe use of new value- error). The cast-to-text /
-- drop / recreate / cast-back sequence is Drizzle 0.26.2+ own enum-change
-- strategy and is fully transaction-safe because it never uses ADD VALUE. The
-- column is nullable with no default, so there is no default to drop/re-add.
ALTER TABLE "public"."manifest" ALTER COLUMN "extraction_reason" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."manifest_extraction_reason";--> statement-breakpoint
CREATE TYPE "public"."manifest_extraction_reason" AS ENUM('unparseable', 'below_sanity_min', 'above_sanity_max', 'no_field', 'object_missing', 'multiple_slips', 'non_standard_format');--> statement-breakpoint
ALTER TABLE "public"."manifest" ALTER COLUMN "extraction_reason" SET DATA TYPE "public"."manifest_extraction_reason" USING "extraction_reason"::"public"."manifest_extraction_reason";
