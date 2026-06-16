-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('ONE_WAY', 'RETURN');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('THRESHOLD', 'NEW_LOW');

-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "origins" TEXT[],
    "destinations" TEXT[],
    "tripType" "TripType" NOT NULL DEFAULT 'RETURN',
    "departFrom" DATE NOT NULL,
    "departTo" DATE NOT NULL,
    "returnFrom" DATE,
    "returnTo" DATE,
    "minStayDays" INTEGER,
    "maxStops" INTEGER NOT NULL DEFAULT 2,
    "directOnly" BOOLEAN NOT NULL DEFAULT false,
    "passengers" INTEGER NOT NULL DEFAULT 1,
    "threshold" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "snoozeUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departDate" DATE NOT NULL,
    "returnDate" DATE,
    "stops" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "airline" TEXT,
    "link" TEXT,
    "foundAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSent" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departDate" DATE NOT NULL,
    "returnDate" DATE,
    "price" INTEGER NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watch_active_idx" ON "Watch"("active");

-- CreateIndex
CREATE INDEX "PriceSnapshot_watchId_observedAt_idx" ON "PriceSnapshot"("watchId", "observedAt");

-- CreateIndex
CREATE INDEX "PriceSnapshot_watchId_origin_destination_departDate_idx" ON "PriceSnapshot"("watchId", "origin", "destination", "departDate");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSent_dedupeKey_key" ON "AlertSent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AlertSent_watchId_sentAt_idx" ON "AlertSent"("watchId", "sentAt");

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSent" ADD CONSTRAINT "AlertSent_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
