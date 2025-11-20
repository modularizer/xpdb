-- Generated CREATE TABLE Script
-- 
-- This file is auto-generated. Do not edit manually.
-- 
-- Generated at: 2025-11-20T20:19:36.034Z
-- Dialect: sqlite
--

CREATE TABLE IF NOT EXISTS "users" (
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

CREATE TABLE IF NOT EXISTS "posts" (
	"id" TEXT NOT NULL,
	"author" TEXT NOT NULL,
	"posted_at" INTEGER DEFAULT (strftime('%s','now')),
	"content" TEXT,
	PRIMARY KEY ("id"),
	FOREIGN KEY ("author") REFERENCES "users" ("name")
);