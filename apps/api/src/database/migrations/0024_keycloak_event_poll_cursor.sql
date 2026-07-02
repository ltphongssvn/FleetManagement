CREATE TABLE "keycloak_event_poll_cursor" (
	"id" varchar(16) PRIMARY KEY DEFAULT 'global' NOT NULL,
	"last_event_time_ms" bigint DEFAULT 0 NOT NULL,
	"last_event_id" varchar(128),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kepc_singleton" CHECK (id = 'global'),
	CONSTRAINT "kepc_last_event_time_nonneg" CHECK (last_event_time_ms >= 0)
);
