/**
 * Easy CREATE Script Generator
 * 
 * Generates CREATE TABLE SQL scripts from a schema file using Drizzle's getTableConfig().
 * This ensures all constraints (primary keys, foreign keys, unique, etc.) are properly included.
 * No database connection is required.
 */

import { generateCreateScript as generateCreateScriptFromSchema } from '../xp-sql/utils/generators/unified-generator';
// Import Node.js utilities (this file is never imported in React Native)
// Metro is configured to ignore node-utils.ts
import { fs, path, requireNodeEnvironment } from './node-utils';

/**
 * Options for CREATE script generation
 */
export interface GenerateCreateScriptOptions {
  /**
   * Path to the source file that exports the schema or table
   */
  sourceFile: string;
  
  /**
   * Name of the export (e.g., 'schema', 'usersTable', or 'default' for default export)
   */
  exportName?: string;
  
  /**
   * SQL dialect to use ('sqlite' or 'pg')
   */
  dialect: 'sqlite' | 'pg';
  
  /**
   * Path to write the generated SQL file
   */
  outputPath?: string;
  
  /**
   * Optional: Path to tsconfig.json (defaults to searching from sourceFile)
   */
  tsconfigPath?: string;
  
  /**
   * Optional: Whether to include IF NOT EXISTS (default: true)
   */
  ifNotExists?: boolean;
  
  /**
   * Optional: Custom header comment for the generated file
   */
  headerComment?: string;
}

/**
 * Result of CREATE script generation
 */
export interface GenerateCreateScriptResult {
  /**
   * The generated SQL script
   */
  sql: string;
  
  /**
   * Path to the generated file
   */
  outputPath: string;
}

/**
 * Generate CREATE TABLE SQL script from a schema file
 * Uses Drizzle's getTableConfig() to extract metadata and build SQL
 */
export async function generateCreateScript(
  options: GenerateCreateScriptOptions
): Promise<GenerateCreateScriptResult> {
  requireNodeEnvironment('generateCreateScript');
  
  if (!fs || !path) {
    throw new Error('Node.js utilities not available');
  }
  const fsSync = fs;
  const pathSync = path;
  
  const {
    sourceFile,
    exportName = 'schema',
    dialect,
    ifNotExists = true,
    headerComment
  } = options;
  let outputPath = options.outputPath;
  
  // Validate sourceFile
  if (!sourceFile) {
    throw new Error('sourceFile is required but was not provided');
  }
  
  // Resolve source file path
  const sourceFilePath = pathSync.resolve(sourceFile);
  if (!fsSync.existsSync(sourceFilePath)) {
    throw new Error(`Source file not found: ${sourceFilePath}`);
  }

  // Handle outputPath: if not provided, use default; if provided, check if it's a directory
  let resolvedOutputPath: string;
  if (!outputPath) {
    let g = pathSync.join(pathSync.dirname(sourceFilePath), 'generated');
    if (!fsSync.existsSync(g)){
      fsSync.mkdirSync(g, { recursive: true });
    }
    resolvedOutputPath = pathSync.join(g, `create-script.${dialect}.sql`);
  } else {
    // Resolve the output path
    resolvedOutputPath = pathSync.resolve(outputPath);
    
    // Check if outputPath is a directory (exists and is a directory, or doesn't exist and has no extension)
    const isDirectory = fsSync.existsSync(resolvedOutputPath) 
      ? fsSync.statSync(resolvedOutputPath).isDirectory()
      : !pathSync.extname(resolvedOutputPath); // If doesn't exist, treat as directory if no extension
    
    if (isDirectory) {
      // Ensure directory exists
      if (!fsSync.existsSync(resolvedOutputPath)) {
        fsSync.mkdirSync(resolvedOutputPath, { recursive: true });
      }
      // Join with default filename
      resolvedOutputPath = pathSync.join(resolvedOutputPath, `create-script.${dialect}.sql`);
    }
  }
  // Load the schema/table from the source file using require (Node.js only)
  // This file should never be bundled for React Native
  if (typeof require === 'undefined') {
    throw new Error('generateCreateScript requires Node.js environment with require()');
  }
  
  // Use require for loading the schema module (Node.js only)
  // Note: This file is never imported in React Native - only loaded via require() in Node.js contexts
  let module: any;
  try {
    // Try with .js extension first (compiled output)
    const modulePathJs = sourceFilePath.replace(/\.ts$/, '.js');
    try {
      module = require(modulePathJs);
    } catch {
      // Try with original path
      module = require(sourceFilePath);
    }
  } catch (error) {
    throw new Error(
      `Failed to require module from ${sourceFilePath}. ` +
      `Make sure the file can be executed (e.g., using tsx or ts-node). ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  
  const schemaOrTable = exportName === 'default' ? module.default : module[exportName];
  if (!schemaOrTable) {
    throw new Error(`Export '${exportName}' not found in module`);
  }
  
  // Generate SQL using unified generator (Step 1: extract dialect-agnostic, Step 2: convert to dialect-specific SQL)
  // schemaOrTable should be a Schema object
  if (!schemaOrTable || typeof schemaOrTable !== 'object' || !('tables' in schemaOrTable)) {
    throw new Error('Expected a Schema object with a tables property');
  }
  const sql = await generateCreateScriptFromSchema(schemaOrTable, dialect, { ifNotExists });
  
  // Generate output file content
  const outputDir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  let fileContent = headerComment || `-- Generated CREATE TABLE Script
-- 
-- This file is auto-generated. Do not edit manually.
-- 
-- Generated at: ${new Date().toISOString()}
-- Dialect: ${dialect}
--

`;

  fileContent += sql.trim();
  
  // Write output file
  fs.writeFileSync(resolvedOutputPath, fileContent);
  
  return {
    sql: sql.trim(),
    outputPath: resolvedOutputPath
  };
}

/**
 * Try to generate CREATE script, catching and logging errors gracefully
 * Provides helpful console output and error handling
 */
export async function tryGenerateCreateScript(
  options: GenerateCreateScriptOptions
): Promise<GenerateCreateScriptResult | null> {
  const { sourceFile, exportName, dialect, outputPath } = options;
  
  console.log(`🔧 Generating CREATE script...`);
  console.log(`   - Source: ${sourceFile}`);
  console.log(`   - Export: ${exportName}`);
  console.log(`   - Dialect: ${dialect}`);
  console.log(`   - Output: ${outputPath}\n`);
  
  try {
    const result = await generateCreateScript(options);
    
    console.log('✅ CREATE script generated successfully!');
    console.log(`   - Output: ${result.outputPath}`);
    console.log(`   - Size: ${result.sql.length} characters`);
    console.log(`   - Lines: ${result.sql.split('\n').length}\n`);
    
    return result;
  } catch (error) {
    console.error('❌ Error generating CREATE script:', error);
    if (error instanceof Error) {
      console.error(`   - Message: ${error.message}`);
      if (error.stack) {
        console.error(`   - Stack: ${error.stack}`);
      }
    }
    console.error('');
    return null;
  }
}




export async function genCreateScript(filename: string, dst?: string, dialects: string[] = ['pg', 'sqlite']) {
    const r = {}
    for (const d of dialects) {
        const result = await tryGenerateCreateScript({
            sourceFile: filename,
            //@ts-ignore
            dialect: d,
            outputPath: dst
        });

        if (!result) {
            process.exit(1);
        }
        // @ts-ignore
        r[d] = result;
    }
    console.log('🎉 All CREATE scripts generated successfully!');
    return r;
}



