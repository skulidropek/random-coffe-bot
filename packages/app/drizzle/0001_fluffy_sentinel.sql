CREATE TABLE "bot_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"update_offset" integer NOT NULL,
	"seed" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"seed" integer NOT NULL,
	"thread_id" integer,
	"title" text,
	"last_summary_at" text
);
--> statement-breakpoint
CREATE TABLE "pair_history" (
	"chat_id" text NOT NULL,
	"pair_key" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "pair_history_chat_id_pair_key_pk" PRIMARY KEY("chat_id","pair_key")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"chat_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"username" text,
	CONSTRAINT "participants_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"poll_id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"summary_date" text NOT NULL,
	"thread_id" integer
);
--> statement-breakpoint
ALTER TABLE "pair_history" ADD CONSTRAINT "pair_history_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "polls_chat_id_unique" ON "polls" USING btree ("chat_id");