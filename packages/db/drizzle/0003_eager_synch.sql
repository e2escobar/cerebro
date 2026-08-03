-- Applications: a flag now belongs to exactly one application, and a key
-- resolves to (application, environment).
--
-- Hand-written rather than generated: the generated version added NOT NULL
-- columns to tables that already have rows, which fails on any database with
-- data in it. Existing flags and keys are rehomed into a `default` application
-- so an upgrade in place keeps working.

CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "application_environment" (
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"config_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "application_environment_application_id_environment_id_pk" PRIMARY KEY("application_id","environment_id")
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_environment" ADD CONSTRAINT "application_environment_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_environment" ADD CONSTRAINT "application_environment_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- A home for anything that already exists. Attributed to an admin if there is
-- one; skipped entirely on a fresh database, where there is nothing to rehome.
INSERT INTO "application" ("key", "name", "description", "created_by")
SELECT 'default', 'Default', 'Flags that existed before applications were introduced.', u."id"
FROM "app_user" u
WHERE EXISTS (SELECT 1 FROM "flag") OR EXISTS (SELECT 1 FROM "api_key")
ORDER BY (u."role" = 'admin') DESC, u."created_at"
LIMIT 1;
--> statement-breakpoint

ALTER TABLE "flag" ADD COLUMN "application_id" uuid;--> statement-breakpoint
UPDATE "flag" SET "application_id" = (SELECT "id" FROM "application" WHERE "key" = 'default');--> statement-breakpoint
ALTER TABLE "flag" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "api_key" ADD COLUMN "application_id" uuid;--> statement-breakpoint
UPDATE "api_key" SET "application_id" = (SELECT "id" FROM "application" WHERE "key" = 'default');--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "audit_log" ADD COLUMN "application_id" uuid;--> statement-breakpoint

-- Carry each environment's current version onto every application, so SDK
-- clients holding an ETag do not see the counter go backwards.
INSERT INTO "application_environment" ("application_id", "environment_id", "config_version")
SELECT a."id", e."id", e."config_version"
FROM "application" a CROSS JOIN "environment" e;
--> statement-breakpoint

ALTER TABLE "api_key" ADD CONSTRAINT "api_key_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag" ADD CONSTRAINT "flag_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_application_idx" ON "api_key" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "flag_application_idx" ON "flag" USING btree ("application_id");--> statement-breakpoint

-- A flag key is unique within its application, not globally.
ALTER TABLE "flag" DROP CONSTRAINT "flag_key_unique";--> statement-breakpoint
ALTER TABLE "flag" ADD CONSTRAINT "flag_application_key_unique" UNIQUE("application_id","key");--> statement-breakpoint

-- The version now lives per (application, environment).
ALTER TABLE "environment" DROP COLUMN "config_version";
