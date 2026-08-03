ALTER TABLE "flag" DROP CONSTRAINT "flag_application_id_application_id_fk";
--> statement-breakpoint
ALTER TABLE "flag" ADD CONSTRAINT "flag_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;