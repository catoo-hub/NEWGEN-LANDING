ALTER TYPE "public"."order_status" ADD VALUE 'paid_waiting_start' BEFORE 'in_progress';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "start_requested" boolean DEFAULT false NOT NULL;