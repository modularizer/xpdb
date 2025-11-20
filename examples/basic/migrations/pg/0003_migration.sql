-- Migration: 0003_migration
-- Hash: cc0a749edf209b02
-- Generated: 2025-11-19T20:39:32.690Z
-- Dialect: pg
--

ALTER TABLE "users" ADD COLUMN "metadata" JSONB;