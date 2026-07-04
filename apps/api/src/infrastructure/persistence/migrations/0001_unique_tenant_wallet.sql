CREATE UNIQUE INDEX "uq_tenants_wallet_public_key" ON "tenants" USING btree ("stellar_wallet_public_key") WHERE "tenants"."stellar_wallet_public_key" IS NOT NULL;
