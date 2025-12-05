/*
  Warnings:

  - You are about to drop the column `razorpayOrderId` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `razorpayPaymentId` on the `orders` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[phonepeMerchantTransactionId]` on the table `orders` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phonepeTransactionId]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "razorpayOrderId",
DROP COLUMN "razorpayPaymentId",
ADD COLUMN     "phonepeMerchantTransactionId" TEXT,
ADD COLUMN     "phonepePaymentInstrumentType" TEXT,
ADD COLUMN     "phonepeResponseCode" TEXT,
ADD COLUMN     "phonepeResponseMessage" TEXT,
ADD COLUMN     "phonepeTransactionId" TEXT,
ADD COLUMN     "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "orders_phonepeMerchantTransactionId_key" ON "orders"("phonepeMerchantTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_phonepeTransactionId_key" ON "orders"("phonepeTransactionId");
