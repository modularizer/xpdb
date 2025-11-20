-- Create Script (Latest Schema)
-- Schema Hash: 25782487680cab88...
-- Generated: 2025-11-19T20:39:32.686Z
-- Dialect: sqlite
-- Migration: 0003_migration
--

CREATE TABLE "users" (
	"id" TEXT NOT NULL,
	"name" TEXT,
	"birthday" INTEGER NOT NULL,
	"gender" TEXT,
	CHECK ("gender" IN ('male','female')),
	"bio" TEXT,
	"headline" TEXT,
	"metadata" TEXT,
	PRIMARY KEY ("id"),
	UNIQUE ("name")
);

CREATE INDEX IF NOT EXISTS "user_name" ON "users" ("name");

CREATE TABLE "posts" (
	"id" TEXT NOT NULL,
	"author" TEXT NOT NULL,
	"posted_at" INTEGER DEFAULT (strftime('%s','now')),
	"content" TEXT,
	PRIMARY KEY ("id"),
	FOREIGN KEY ("author") REFERENCES "users" ("name")
);