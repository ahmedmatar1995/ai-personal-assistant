CREATE TYPE "platform" AS ENUM('telegram');--> statement-breakpoint
ALTER TABLE "channel_identifiers" ADD COLUMN "id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "channel_identifiers" DROP CONSTRAINT "channel_identifiers_pkey";--> statement-breakpoint
ALTER TABLE "channel_identifiers" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "channel_identifiers" ALTER COLUMN "platform" SET DATA TYPE "platform" USING "platform"::"platform";--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identifiers_platform_external_idx" ON "channel_identifiers" ("platform","external_id");