CREATE TABLE "user_activation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_key" varchar(100) NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activation_task_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_key" varchar(100) NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_activation_tasks" ADD CONSTRAINT "user_activation_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_activation_task_actions" ADD CONSTRAINT "user_activation_task_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_activation_tasks_user_task_idx" ON "user_activation_tasks" USING btree ("user_id","task_key");
--> statement-breakpoint
CREATE INDEX "user_activation_tasks_user_idx" ON "user_activation_tasks" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_activation_task_actions_user_task_subject_idx" ON "user_activation_task_actions" USING btree ("user_id","task_key","subject_id");
--> statement-breakpoint
CREATE INDEX "user_activation_task_actions_user_task_idx" ON "user_activation_task_actions" USING btree ("user_id","task_key");
