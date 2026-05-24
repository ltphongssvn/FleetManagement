CREATE UNIQUE INDEX "device_registry_operator_platform_uq" ON "device_registry" USING btree ("operator_id","platform");
