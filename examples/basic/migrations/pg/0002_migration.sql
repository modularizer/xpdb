-- Migration: 0002_migration
-- Hash: fd915f79c11c1954
-- Generated: 2025-11-19T20:39:09.634Z
-- Dialect: pg
--

ALTER TABLE "users" ALTER COLUMN "headline" TYPE VARCHAR(40);