-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "name" TEXT,
    "avatar" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "headers" JSONB DEFAULT '{}',
    "body" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 300,
    "timeout" INTEGER NOT NULL DEFAULT 30,
    "expected_status" INTEGER,
    "expected_keyword" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'global',

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checks" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_time" INTEGER NOT NULL,
    "error" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "region" TEXT NOT NULL DEFAULT 'global',

    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'triggered',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'free',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_pages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "logo" TEXT,
    "brand_color" TEXT NOT NULL DEFAULT '#3b82f6',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "status_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_items" (
    "id" TEXT NOT NULL,
    "status_page_id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "display_name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "status_page_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "monitors_user_id_idx" ON "monitors"("user_id");

-- CreateIndex
CREATE INDEX "monitors_is_active_idx" ON "monitors"("is_active");

-- CreateIndex
CREATE INDEX "monitors_is_paused_idx" ON "monitors"("is_paused");

-- CreateIndex
CREATE INDEX "checks_monitor_id_idx" ON "checks"("monitor_id");

-- CreateIndex
CREATE INDEX "checks_checked_at_idx" ON "checks"("checked_at");

-- CreateIndex
CREATE INDEX "checks_status_idx" ON "checks"("status");

-- CreateIndex
CREATE INDEX "alerts_monitor_id_idx" ON "alerts"("monitor_id");

-- CreateIndex
CREATE INDEX "alerts_user_id_idx" ON "alerts"("user_id");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE INDEX "alerts_sent_at_idx" ON "alerts"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_slug_key" ON "status_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_items_status_page_id_monitor_id_key" ON "status_page_items"("status_page_id", "monitor_id");

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_items" ADD CONSTRAINT "status_page_items_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_items" ADD CONSTRAINT "status_page_items_status_page_id_fkey" FOREIGN KEY ("status_page_id") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

