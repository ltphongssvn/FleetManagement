ALTER TABLE "driver" DROP CONSTRAINT "driver_company_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "driver_company_active_name_ci_uq" ON "driver" USING btree ("company_id",lower("full_name")) WHERE active = true;
