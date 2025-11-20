-- Migration: 0002_migration
-- Hash: 4469c24248b85c61
-- Generated: 2025-11-19T20:39:09.631Z
-- Dialect: sqlite
--

CREATE TABLE "users_new" (
	"id" TEXT NOT NULL,
	"name" TEXT,
	"birthday" INTEGER NOT NULL,
	"gender" TEXT,
	CHECK ("gender" IN ('male','female')),
	"bio" TEXT,
	"headline" TEXT,
	PRIMARY KEY ("id"),
	UNIQUE ("name")
);
INSERT INTO "users_new" ("id", "name", "birthday", "gender", "bio", "headline") SELECT "id", "name", "birthday", "gender", "bio", "headline" FROM "users";
DROP TABLE "users";
ALTER TABLE "users_new" RENAME TO "users";
CREATE INDEX IF NOT EXISTS "user_name" ON "users" ("name");