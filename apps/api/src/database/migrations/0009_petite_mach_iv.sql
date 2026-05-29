ALTER TABLE "driver" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "password_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_company_phone_uq" UNIQUE("company_id","phone");
