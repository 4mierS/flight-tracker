-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "dailyMessageCap" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertSent_sentAt_idx" ON "AlertSent"("sentAt");
