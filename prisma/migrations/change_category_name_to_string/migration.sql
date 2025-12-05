-- Create a temporary text column
ALTER TABLE "categories" ADD COLUMN "name_temp" TEXT;

-- Convert enum values to text
UPDATE "categories" SET "name_temp" = "name"::text;

-- Drop the old column
ALTER TABLE "categories" DROP COLUMN "name";

-- Rename the temporary column
ALTER TABLE "categories" RENAME COLUMN "name_temp" TO "name";

-- Add unique constraint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_key" UNIQUE ("name");

-- Drop the old enum type
DROP TYPE "CategoryType";