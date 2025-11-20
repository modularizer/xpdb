-- Create Script (Latest Schema)
-- Schema Hash: 225591bd0c4499a3...
-- Generated: 2025-11-19T20:39:32.690Z
-- Dialect: pg
-- Migration: 0003_migration
--

CREATE TABLE "users" (
	"id" VARCHAR(16) NOT NULL,
	"name" TEXT,
	"birthday" TIMESTAMP NOT NULL,
	"gender" TEXT,
	CHECK ("gender" IN ('male','female')),
	"bio" TEXT,
	"headline" VARCHAR(40),
	"metadata" JSONB,
	PRIMARY KEY ("id"),
	UNIQUE ("name")
);

CREATE INDEX IF NOT EXISTS "user_name" ON "users" ("name");

CREATE TABLE "posts" (
	"id" VARCHAR(16) NOT NULL,
	"author" TEXT NOT NULL,
	"posted_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	"content" VARCHAR(2000),
	PRIMARY KEY ("id"),
	FOREIGN KEY ("author") REFERENCES "users" ("name")
);