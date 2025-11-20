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
  // Need to be careful not to split on semicolons inside string literals or parentheses
  const statements: string[] = [];
  let currentStatement = '';
  let depth = 0; // Track nesting depth for parentheses
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];
    
    // Track string literals
    if ((char === "'" || char === '"') && (i === 0 || sql[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }
    
    // Track parentheses depth (only when not in string)
    if (!inString) {
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
      
      // Split on semicolon only when at top level (depth === 0) and not in string
      if (char === ';' && depth === 0 && !inString) {
        const trimmed = currentStatement.trim();
        if (trimmed && !trimmed.startsWith('--')) {
          statements.push(trimmed);
        }
        currentStatement = '';
        continue;
      }
    }
    
    currentStatement += char;
  }
  
  // Add the last statement if any
  const trimmed = currentStatement.trim();
  if (trimmed && !trimmed.startsWith('--')) {
    statements.push(trimmed);
  }
  
  for (const statement of statements) {
    try {
      // Parse the statement to validate syntax
      parser.astify(statement, { database: parserDialect });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`SQL validation error in statement: ${errorMessage}\nStatement: ${statement.substring(0, 200)}${statement.length > 200 ? '...' : ''}`);
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

