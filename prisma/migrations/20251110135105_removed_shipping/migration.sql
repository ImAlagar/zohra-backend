/*
  Warnings:

  - You are about to drop the column `shippingCost` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the `shipping_rates` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "shippingCost";

-- DropTable
DROP TABLE "shipping_rates";
