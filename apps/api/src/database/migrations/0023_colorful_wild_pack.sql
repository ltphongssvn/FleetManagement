ALTER TABLE "dispatch_board_projection" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_board_projection_active_idx" ON "dispatch_board_projection" USING btree ("company_id") WHERE "deleted_at" is null;
