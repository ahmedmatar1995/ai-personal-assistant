CREATE TABLE "channel_identifiers" (
	"platform" text,
	"external_id" text,
	"clerk_user_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_identifiers_pkey" PRIMARY KEY("platform","external_id")
);
