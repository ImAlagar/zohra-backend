-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "adminNotes" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;
