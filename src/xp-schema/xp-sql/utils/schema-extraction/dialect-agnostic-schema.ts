/**
 * Dialect-Agnostic Schema Representation
 * 
 * This module defines the structure for a completely dialect-agnostic schema
 * that can be extracted from unbound tables and then converted to dialect-specific SQL.
 */

import type { ForeignKeyAction } from '../../dialects/types';

/**
 * Dialect-agnostic column metadata
 * Contains only abstract type information, no SQL-specific strings
 */
export interface DialectAgnosticColumnMetadata {
  name: string;
  columnType: string; // Abstract type: 'varchar', 'text', 'integer', 'bigint', 'real', 'boolean', 'timestamp', 'date', 'time', 'json', 'blob'
  options?: {
    length?: number;
    precision?: number;
    scale?: number;
    enum?: readonly string[];
  };
  nullable: boolean;
  hasDefault: boolean; // Only true for database-level defaults
  defaultValue?: any; // Raw default value (SQL expression structure, literal, or marker like {method: 'defaultNow'})
}

/**
 * Dialect-agnostic table metadata
 */
export interface DialectAgnosticTableMetadata {
  name: string;
  columns: Record<string, DialectAgnosticColumnMetadata>;
  primaryKeys: string[];
  foreignKeys: Array<{
    localColumns: string[];
    refTable: string;
    refColumns: string[];
    onDelete?: ForeignKeyAction;
    onUpdate?: ForeignKeyAction;
  }>;
  uniqueConstraints: Array<{
    name?: string;
    columns: string[];
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
  }>;
}

/**
 * Dialect-agnostic schema (complete schema representation)
 */
export interface DialectAgnosticSchema {
  version: number;
  timestamp: number;
  tables: Record<string, DialectAgnosticTableMetadata>;
  schemaHash?: string; // Hash of the tables JSON for unique identification
}

