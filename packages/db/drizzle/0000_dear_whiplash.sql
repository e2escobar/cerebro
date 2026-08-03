CREATE TYPE "public"."api_key_kind" AS ENUM('server', 'client');--> statement-breakpoint
CREATE TYPE "public"."env_permission_kind" AS ENUM('read', 'write', 'toggle', 'promote');--> statement-breakpoint
CREATE TYPE "public"."flag_env_state" AS ENUM('not_promoted', 'promoted');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('boolean', 'string', 'number', 'json');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'developer');--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'developer' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"environment_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "env_permission" (
	"user_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"permission" "env_permission_kind" NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "env_permission_user_id_environment_id_permission_pk" PRIMARY KEY("user_id","environment_id","permission")
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"config_version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_key_unique" UNIQUE("key"),
	CONSTRAINT "environment_rank_unique" UNIQUE("rank")
);
--> statement-breakpoint
CREATE TABLE "flag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "flag_type" NOT NULL,
	"default_value" jsonb NOT NULL,
	"is_client_safe" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flag_key_unique" UNIQUE("key"),
	CONSTRAINT "flag_default_value_matches_type" CHECK (("flag"."type" = 'boolean' AND jsonb_typeof("flag"."default_value") = 'boolean')
       OR ("flag"."type" = 'string'  AND jsonb_typeof("flag"."default_value") = 'string')
       OR ("flag"."type" = 'number'  AND jsonb_typeof("flag"."default_value") = 'number')
       OR ("flag"."type" = 'json'))
);
--> statement-breakpoint
CREATE TABLE "flag_environment" (
	"flag_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"state" "flag_env_state" DEFAULT 'not_promoted' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"value" jsonb NOT NULL,
	"promoted_at" timestamp with time zone,
	"first_enabled_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flag_environment_flag_id_environment_id_pk" PRIMARY KEY("flag_id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "promotion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"from_env_id" uuid,
	"to_env_id" uuid NOT NULL,
	"value_snapshot" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_permission" ADD CONSTRAINT "env_permission_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_permission" ADD CONSTRAINT "env_permission_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_permission" ADD CONSTRAINT "env_permission_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag" ADD CONSTRAINT "flag_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_environment" ADD CONSTRAINT "flag_environment_flag_id_flag_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_environment" ADD CONSTRAINT "flag_environment_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_environment" ADD CONSTRAINT "flag_environment_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_flag_id_flag_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_from_env_id_environment_id_fk" FOREIGN KEY ("from_env_id") REFERENCES "public"."environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_to_env_id_environment_id_fk" FOREIGN KEY ("to_env_id") REFERENCES "public"."environment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_environment_id_idx" ON "api_key" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "flag_archived_at_idx" ON "flag" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "flag_environment_env_state_idx" ON "flag_environment" USING btree ("environment_id","state");--> statement-breakpoint
CREATE INDEX "promotion_flag_created_idx" ON "promotion" USING btree ("flag_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");