-- Migration: 0001_initial
-- Hash: 4870f7d0280f0bf3
-- Generated: 2025-11-19T20:38:50.972Z
-- Dialect: pg
--

CREATE TABLE "users" (
	"id" VARCHAR(16) NOT NULL,
	"name" TEXT,
	"birthday" TIMESTAMP NOT NULL,
	"gender" TEXT,
	CHECK ("gender" IN ('male','female')),
	"bio" TEXT,
	"headline" VARCHAR(30),
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