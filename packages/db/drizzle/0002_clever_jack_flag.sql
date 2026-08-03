ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_environment_id_environment_id_fk";
--> statement-breakpoint
ALTER TABLE "promotion" DROP CONSTRAINT "promotion_from_env_id_environment_id_fk";
--> statement-breakpoint
ALTER TABLE "promotion" DROP CONSTRAINT "promotion_to_env_id_environment_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_from_env_id_environment_id_fk" FOREIGN KEY ("from_env_id") REFERENCES "public"."environment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_to_env_id_environment_id_fk" FOREIGN KEY ("to_env_id") REFERENCES "public"."environment"("id") ON DELETE cascade ON UPDATE no action;