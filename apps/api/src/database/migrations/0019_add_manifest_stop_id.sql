ALTER TABLE "manifest" ADD COLUMN "stop_id" uuid;--> statement-breakpoint
ALTER TABLE "manifest" ADD CONSTRAINT "manifest_stop_id_stop_stop_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stop"("stop_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_stop_idx" ON "manifest" USING btree ("stop_id");
