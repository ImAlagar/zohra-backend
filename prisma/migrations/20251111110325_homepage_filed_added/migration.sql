-- CreateTable
CREATE TABLE "home_sliders" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "smallText" TEXT,
    "offerText" TEXT,
    "buttonText" TEXT,
    "buttonLink" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'left',
    "bgImage" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "imagePublicId" TEXT,
    "bgImagePublicId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_sliders_pkey" PRIMARY KEY ("id")
);
