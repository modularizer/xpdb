/**
 * Utility functions for foreign key handling in the database viewer
 */

import type { ForeignKeyInfo } from '../xp-schema/xp-sql/dialects/types';

/**
 * Determines the best column to use for displaying a foreign key reference.
 * Prefers "name" or "Name" column (case-insensitive), otherwise uses the first column that's not "id", "uuid", or ending in "_id"
 */
export function determineLookupColumn(
  columns: string[],
  preferredColumn?: string
): string | null {
  if (columns.length === 0) return null;
  
  // If a preferred column is specified and exists, use it
  if (preferredColumn && columns.includes(preferredColumn)) {
    return preferredColumn;
  }
  
  // Prefer "name" column (case-insensitive)
  const nameColumn = columns.find(col => col.toLowerCase() === 'name');
  if (nameColumn) {
    return nameColumn;
  }
  
  // Find first column that's not id, uuid, or ending in _id
  const excludedPatterns = ['id', 'uuid'];
  const excludedSuffixes = ['_id'];
  
  for (const col of columns) {
    const lowerCol = col.toLowerCase();
    if (
      !excludedPatterns.includes(lowerCol) &&
      !excludedSuffixes.some(suffix => lowerCol.endsWith(suffix))
    ) {
      return col;
    }
  }
  
  // Fallback: use first column
  return columns[0];
}

/**
 * Maps a column name to its FK info if it's part of a foreign key
 */
export function getFKForColumn(
  columnName: string,
  foreignKeys: ForeignKeyInfo[]
): ForeignKeyInfo | null {
  for (const fk of foreignKeys) {
    if (fk.columns.includes(columnName)) {
      return fk;
    }
  }
  return null;
}

/**
 * Gets the referenced column name for a FK column
 * For single-column FKs, returns the referenced column
 * For multi-column FKs, returns the referenced column at the same index
 */
export function getReferencedColumn(
  columnName: string,
  fk: ForeignKeyInfo
): string | null {
  const localIndex = fk.columns.indexOf(columnName);
  if (localIndex === -1) return null;
  return fk.referencedColumns[localIndex] || null;
}

