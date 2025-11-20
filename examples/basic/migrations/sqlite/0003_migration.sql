-- Migration: 0003_migration
-- Hash: 2b8dba32d03cbb3e
-- Generated: 2025-11-19T20:39:32.686Z
-- Dialect: sqlite
--

ALTER TABLE "users" ADD COLUMN "metadata" TEXT;