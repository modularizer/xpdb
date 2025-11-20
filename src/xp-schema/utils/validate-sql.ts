/**
 * SQL Validation Utility
 * 
 * Uses node-sql-parser to validate generated SQL statements
 */

import { Parser } from 'node-sql-parser';

const parser = new Parser();

/**
 * Validate SQL statement(s) for a specific dialect
 * 
 * @param sql - SQL string (can contain multiple statements)
 * @param dialect - SQL dialect ('pg' for PostgreSQL, 'sqlite' for SQLite)
 * @returns Validation result with errors if any
 */
export function validateSQL(sql: string, dialect: 'pg' | 'sqlite'): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Map our dialect names to node-sql-parser dialect names
  const parserDialect = dialect === 'pg' ? 'postgresql' : 'sqlite';
  
  // Split SQL into individual statements (semicolon-separated)
  // Remove comments and empty statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const statement of statements) {
    try {
      // Parse the statement to validate syntax
      parser.astify(statement, { database: parserDialect });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`SQL validation error in statement: ${errorMessage}\nStatement: ${statement.substring(0, 100)}${statement.length > 100 ? '...' : ''}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate SQL and throw if invalid
 * 
 * @param sql - SQL string to validate
 * @param dialect - SQL dialect
 * @param context - Optional context string for error messages
 * @throws Error if SQL is invalid
 */
export function validateSQLOrThrow(sql: string, dialect: 'pg' | 'sqlite', context?: string): void {
  const result = validateSQL(sql, dialect);
  
  if (!result.valid) {
    const contextMsg = context ? ` (${context})` : '';
    throw new Error(
      `SQL validation failed${contextMsg}:\n${result.errors.join('\n\n')}`
    );
  }
}

