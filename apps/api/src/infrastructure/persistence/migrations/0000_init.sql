CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"admin_email" text NOT NULL,
	"stellar_wallet_public_key" text,
	"stellar_network" text DEFAULT 'TESTNET' NOT NULL,
	"default_asset_code" text NOT NULL,
	"default_asset_issuer" text,
	"status" text DEFAULT 'INACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_document_number_unique" UNIQUE("document_number"),
	CONSTRAINT "chk_tenants_document_type" CHECK ("tenants"."document_type" IN ('CNPJ','CPF','OTHER')),
	CONSTRAINT "chk_tenants_status" CHECK ("tenants"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "chk_tenants_network" CHECK ("tenants"."stellar_network" = 'TESTNET'),
	CONSTRAINT "chk_tenants_wallet_format" CHECK ("tenants"."stellar_wallet_public_key" IS NULL OR "tenants"."stellar_wallet_public_key" ~ '^G[A-Z2-7]{55}$')
);
--> statement-breakpoint
CREATE TABLE "blockchain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tx_hash" text,
	"ledger" bigint,
	"status" text NOT NULL,
	"raw_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_blockchain_tx_kind" CHECK ("blockchain_transactions"."kind" IN ('register','pay','cancel','expire')),
	CONSTRAINT "chk_blockchain_tx_status" CHECK ("blockchain_transactions"."status" IN ('pending','submitted','success','failed'))
);
--> statement-breakpoint
CREATE TABLE "payment_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_id" text,
	"amount" numeric(20, 7) NOT NULL,
	"asset_code" text NOT NULL,
	"asset_issuer" text,
	"receiver_wallet_public_key" text NOT NULL,
	"canonical_payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"due_date" date,
	"description" text,
	"public_payment_slug" text NOT NULL,
	"soroban_contract_id" text,
	"blockchain_transaction_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_orders_public_payment_slug_unique" UNIQUE("public_payment_slug"),
	CONSTRAINT "chk_payment_orders_amount_positive" CHECK ("payment_orders"."amount" > 0),
	CONSTRAINT "chk_payment_orders_status" CHECK ("payment_orders"."status" IN ('CREATED','ACTIVE','PAID','EXPIRED','CANCELLED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "accepted_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"issuer" text,
	"network" text DEFAULT 'TESTNET' NOT NULL,
	"sac_address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_order_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_url" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"request_signature" text,
	"response_status" integer,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"correlation_id" text,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"webhook_secret_hash" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_tenant_ids" uuid[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_prefix_unique" UNIQUE("key_prefix")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order_events" ADD CONSTRAINT "payment_order_events_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenants_status" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_blockchain_tx_order" ON "blockchain_transactions" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "idx_blockchain_tx_hash" ON "blockchain_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_blockchain_tx_status" ON "blockchain_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_order_events_order_created" ON "payment_order_events" USING btree ("payment_order_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_order_events_type" ON "payment_order_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_tenant" ON "payment_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_status" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_due_date_active" ON "payment_orders" USING btree ("due_date") WHERE "payment_orders"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_payment_orders_tx_hash" ON "payment_orders" USING btree ("blockchain_transaction_hash");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_canonical_hash" ON "payment_orders" USING btree ("canonical_payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_orders_tenant_external" ON "payment_orders" USING btree ("tenant_id","external_id") WHERE "payment_orders"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accepted_assets_code_issuer_network" ON "accepted_assets" USING btree ("code",coalesce("issuer", ''),"network");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_order" ON "webhook_deliveries" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_status_retry" ON "webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_api_keys_active" ON "api_keys" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idempotency_key_endpoint" ON "idempotency_keys" USING btree ("key","endpoint");