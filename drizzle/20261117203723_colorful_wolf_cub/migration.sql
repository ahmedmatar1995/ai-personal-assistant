CREATE TABLE "link_codes" (
	"code" text PRIMARY KEY,
	"telegram_user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"clerk_user_id" text,
	"trigger_token_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
