/**
 * Type Generator Utility
 * 
 * Generates fully expanded TypeScript type declarations for $inferSelect and $inferInsert
 * from either a schema (XPSchemaPlusWithTables) or an individual table (UTable).
 * 
 * This utility works by analyzing the source file where the schema/table is defined,
 * extracting the types using TypeScript's type system, and generating fully expanded
 * type declarations.
 * 
 * **Note:** This utility requires a source file path because TypeScript types are
 * compile-time only and cannot be extracted from runtime objects. The schema/table
 * must be exported from the source file.
 * 
 * @example
 * ```typescript
 * import { generateTypes } from './utils/generate-types';
 * 
 * // Generate types for a schema defined in a file
 * // Assuming schema.ts exports: export const schema = xpschema({ ... });
 * await generateTypes({
 *   sourceFile: './schema.ts',
 *   exportName: 'schema', // name of the exported schema
 *   outputPath: './generated-types.ts'
 * });
 * 
 * // Generate types for a single table
 * // Assuming tables.ts exports: export const usersTable = table('users', { ... });
 * await generateTypes({
 *   sourceFile: './tables.ts',
 *   exportName: 'usersTable', // name of the exported table
 *   outputPath: './generated-user-types.ts',
 *   tableName: 'users' // optional: name for the generated type
 * });
 * 
 * // For default exports, use 'default' as exportName
 * await generateTypes({
 *   sourceFile: './schema.ts',
 *   exportName: 'default',
 *   outputPath: './generated-types.ts'
 * });
 * ```
 */
// Import Node.js utilities (this file is never imported in React Native)
// Metro is configured to ignore node-utils.ts
import { fs, path, requireNodeEnvironment } from './node-utils';
import type { Project } from 'ts-morph';


/**
 * Options for type generation
 */
export interface GenerateTypesOptions {
  /**
   * Path to the source file that exports the schema or table
   */
  sourceFile: string;
  
  /**
   * Name of the export (e.g., 'schema', 'usersTable', or 'default' for default export)
   */
  exportName?: string;
  
  /**
   * Path to write the generated types file
   */
  outputPath?: string;
  
  /**
   * Optional: Name for the table (used when generating types for a single table)
   */
  tableName?: string;
  
  /**
   * Optional: Path to tsconfig.json (defaults to searching from sourceFile)
   */
  tsconfigPath?: string;
  
  /**
   * Optional: Additional imports to include in the generated file
   */
  imports?: string[];
  
  /**
   * Optional: Custom header comment for the generated file
   */
  headerComment?: string;
}

/**
 * Result of type generation
 */
export interface GenerateTypesResult {
  /**
   * The generated type code strings
   */
  types: {
    select?: string;
    insert?: string;
  };
  
  /**
   * Whether types were successfully expanded
   */
  expanded: boolean;
  
  /**
   * Path to the generated file
   */
  outputPath: string;
}

/**
 * Format a type string for readability
 */
function formatTypeString(typeStr: string): string {
  // Clean up whitespace first
  let cleaned = typeStr.replace(/\s+/g, ' ').trim();
  
  // Remove redundant | undefined from optional properties (prop?: T | undefined -> prop?: T)
  // Handle both | undefined and undefined | patterns
  cleaned = cleaned.replace(/\?:\s*([^;]+?)\s*\|\s*undefined(?=\s*[;}]|$)/g, '?: $1');
  cleaned = cleaned.replace(/\?:\s*undefined\s*\|\s*([^;]+?)(?=\s*[;}]|$)/g, '?: $1');
  // Also handle undefined in the middle: string | undefined | null
  cleaned = cleaned.replace(/(\?:\s*[^;|]+?)\s*\|\s*undefined\s*\|\s*([^;|]+?)(?=\s*[;}]|$)/g, '$1 | $2');
  
  // If it's an object type, format it nicely
  if (cleaned.startsWith('{') && cleaned.includes(':')) {
    // Remove the outer braces temporarily
    const inner = cleaned.slice(1, -1).trim();
    
    // Split by semicolons (property separators in TypeScript)
    const parts = inner.split(';')
      .map(part => part.trim())
      .filter(part => part.length > 0);
    
    if (parts.length > 0) {
      const formatted = parts
        .map(part => {
          // Remove | undefined from optional properties in each part
          part = part.replace(/\?:\s*([^;]+?)\s*\|\s*undefined(?=\s*[;}]|$)/g, '?: $1');
          part = part.replace(/\?:\s*undefined\s*\|\s*([^;]+?)(?=\s*[;}]|$)/g, '?: $1');
          // Also handle undefined in the middle: string | undefined | null
          part = part.replace(/(\?:\s*[^;|]+?)\s*\|\s*undefined\s*\|\s*([^;|]+?)(?=\s*[;}]|$)/g, '$1 | $2');
          // Add proper indentation and semicolon
          return '  ' + part + ';';
        })
        .join('\n');
      
      return '{\n' + formatted + '\n}';
    }
    
    return '{}';
  }
  
  // For non-object types, return cleaned
  return cleaned;
}

/**
 * Create a temporary file that imports and references the schema/table for type extraction
 */
async function createTempTypeFile(
  sourceFile: string,
  exportName: string,
  tempDir: string,
  tableName?: string
): Promise<string> {
  requireNodeEnvironment('createTempTypeFile');
  
  if (!fs || !path) {
    throw new Error('Node.js utilities not available');
  }
  const fsSync = fs;
  const pathSync = path;
  
  const tempFilePath = pathSync.join(tempDir, 'temp-types.ts');
  const sourcePath = pathSync.resolve(sourceFile);
  const relativePath = pathSync.relative(tempDir, sourcePath).replace(/\\/g, '/').replace(/\.ts$/, '');
  
  let content = `// Temporary file for type extraction\n\n`;
  content += `import { ${exportName === 'default' ? `${exportName} as schemaOrTable` : exportName} } from '${relativePath}';\n\n`;
  
  if (tableName) {
    // Single table
    const typeName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
    const varName = exportName === 'default' ? 'schemaOrTable' : exportName;
    content += `export type ${typeName}TableRecord = typeof ${varName}.$inferSelect;\n`;
    content += `export type ${typeName}TableInsert = typeof ${varName}.$inferInsert;\n`;
  } else {
    // Schema - extract all tables
    const varName = exportName === 'default' ? 'schemaOrTable' : exportName;
    content += `// Extract table names from schema\n`;
    content += `type SchemaType = typeof ${varName};\n`;
    content += `type Tables = SchemaType extends { tables: infer T } ? T : never;\n`;
    content += `type TableNames = keyof Tables;\n\n`;
    content += `// This will be populated by analyzing the actual schema\n`;
    content += `export type SchemaSelect<T extends TableNames> = typeof ${varName}[T]['$inferSelect'];\n`;
    content += `export type SchemaInsert<T extends TableNames> = typeof ${varName}[T]['$inferInsert'];\n`;
  }
  
  fsSync.writeFileSync(tempFilePath, content);
  return tempFilePath;
}

/**
 * Extract and expand types using ts-morph
 * Analyzes the temporary file's type aliases to extract fully expanded types
 */
function extractTypes(
  tempFilePath: string,
  sourceFilePath: string,
  exportName: string,
  project: any,
  typeChecker: any,
  tableName?: string
): { select?: string; insert?: string }[] | Map<string, { select?: string; insert?: string }> {
  requireNodeEnvironment('extractTypes');
  
  const { TypeFormatFlags, VariableDeclaration } = require('ts-morph');
  
  const tempSourceFile = project.addSourceFileAtPath(tempFilePath);
  
  if (tableName) {
    // Single table - extract from type aliases in temp file
    const typeName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
    const selectTypeAlias = tempSourceFile.getTypeAlias(`${typeName}TableRecord`);
    const insertTypeAlias = tempSourceFile.getTypeAlias(`${typeName}TableInsert`);
    
    const result: { select?: string; insert?: string } = {};
    
    if (selectTypeAlias) {
      try {
        const selectTypeStr = selectTypeAlias.getType().getText(
          undefined,
          TypeFormatFlags.NoTruncation | 
          TypeFormatFlags.InTypeAlias | 
          TypeFormatFlags.WriteArrayAsGenericType
        );
        result.select = formatTypeString(selectTypeStr);
      } catch (error) {
        console.warn(`⚠️  Could not expand select type:`, error instanceof Error ? error.message : error);
      }
    }
    
    if (insertTypeAlias) {
      try {
        const insertTypeStr = insertTypeAlias.getType().getText(
          undefined,
          TypeFormatFlags.NoTruncation | 
          TypeFormatFlags.InTypeAlias | 
          TypeFormatFlags.WriteArrayAsGenericType
        );
        result.insert = formatTypeString(insertTypeStr);
      } catch (error) {
        console.warn(`⚠️  Could not expand insert type:`, error instanceof Error ? error.message : error);
      }
    }
    
    return [result];
  } else {
    // Schema - need to extract table names first, then create type aliases for each
    const originalSourceFile = project.addSourceFileAtPath(sourceFilePath);
    
    // Get the exported variable to determine table names
    const { VariableDeclaration } = require('ts-morph');
    let exportedVar: any | undefined;
    if (exportName === 'default') {
      const defaultExport = originalSourceFile.getDefaultExportSymbol();
      if (defaultExport) {
        const declarations = defaultExport.getDeclarations();
        if (declarations.length > 0 && declarations[0].getKindName() === 'VariableDeclaration') {
          exportedVar = declarations[0] as VariableDeclaration;
        }
      }
    } else {
      const exportSymbol = originalSourceFile.getExportSymbols().find(s => s.getName() === exportName);
      if (exportSymbol) {
        const declarations = exportSymbol.getDeclarations();
        if (declarations.length > 0 && declarations[0].getKindName() === 'VariableDeclaration') {
          exportedVar = declarations[0] as VariableDeclaration;
        }
      }
    }
    
    if (!exportedVar) {
      throw new Error(`Could not find export '${exportName}' in ${sourceFilePath}`);
    }
    
    const exportedType = typeChecker.getTypeAtLocation(exportedVar);
    const tablesProp = exportedType.getProperty('tables');
    
    if (!tablesProp) {
      throw new Error(`Export '${exportName}' does not appear to be a schema (missing 'tables' property)`);
    }
    
    const tablesType = typeChecker.getTypeOfSymbolAtLocation(tablesProp, exportedVar);
    const tableNames = tablesType.getProperties().map(prop => prop.getName());
    
    // Now extract types for each table by analyzing the temp file
    // We need to update the temp file to have type aliases for each table
    const results = new Map<string, { select?: string; insert?: string }>();
    
    // Re-create temp file with type aliases for each table
    requireNodeEnvironment('tryGenerateTypes');
    
    if (!fs || !path) {
      throw new Error('Node.js utilities not available');
    }
    const fsSync = fs;
    const pathSync = path;
    
    const tempDir = pathSync.dirname(tempFilePath);
    const sourcePath = pathSync.resolve(sourceFilePath);
    const relativePath = pathSync.relative(tempDir, sourcePath).replace(/\\/g, '/').replace(/\.ts$/, '');
    const varName = exportName === 'default' ? 'schemaOrTable' : exportName;
    
    let tempContent = `// Temporary file for type extraction\n\n`;
    tempContent += `import { ${exportName === 'default' ? `${exportName} as schemaOrTable` : exportName} } from '${relativePath}';\n\n`;
    
    for (const name of tableNames) {
      const typeName = name.charAt(0).toUpperCase() + name.slice(1);
      tempContent += `export type ${typeName}TableRecord = typeof ${varName}.${name}.$inferSelect;\n`;
      tempContent += `export type ${typeName}TableInsert = typeof ${varName}.${name}.$inferInsert;\n\n`;
    }
    
    fsSync.writeFileSync(tempFilePath, tempContent);
    
    // Re-add the file to the project (remove and re-add to refresh)
    project.removeSourceFile(tempSourceFile);
    const updatedTempFile = project.addSourceFileAtPath(tempFilePath);
    
    // Extract types from the updated temp file
    for (const name of tableNames) {
      const typeName = name.charAt(0).toUpperCase() + name.slice(1);
      const selectTypeAlias = updatedTempFile.getTypeAlias(`${typeName}TableRecord`);
      const insertTypeAlias = updatedTempFile.getTypeAlias(`${typeName}TableInsert`);
      
      const result: { select?: string; insert?: string } = {};
      
      if (selectTypeAlias) {
        try {
          const selectTypeStr = selectTypeAlias.getType().getText(
            undefined,
            TypeFormatFlags.NoTruncation | 
            TypeFormatFlags.InTypeAlias | 
            TypeFormatFlags.WriteArrayAsGenericType
          );
          result.select = formatTypeString(selectTypeStr);
        } catch (error) {
          console.warn(`⚠️  Could not expand select type for ${name}:`, error instanceof Error ? error.message : error);
        }
      }
      
      if (insertTypeAlias) {
        try {
          const insertTypeStr = insertTypeAlias.getType().getText(
            undefined,
            TypeFormatFlags.NoTruncation | 
            TypeFormatFlags.InTypeAlias | 
            TypeFormatFlags.WriteArrayAsGenericType
          );
          result.insert = formatTypeString(insertTypeStr);
        } catch (error) {
          console.warn(`⚠️  Could not expand insert type for ${name}:`, error instanceof Error ? error.message : error);
        }
      }
      
      results.set(name, result);
    }
    
    return results;
  }
}

/**
 * Generate fully expanded TypeScript types from a schema or table
 */
export async function generateTypes(options: GenerateTypesOptions): Promise<GenerateTypesResult> {
  requireNodeEnvironment('generateTypes');
  
  if (!fs || !path) {
    throw new Error('Node.js utilities not available');
  }
  
  // Dynamic import for ts-morph (peer dependency)
  const tsMorph = require('ts-morph');
  const { Project } = tsMorph;
  
  const fsSync = fs;
  const pathSync = path;
  
  const {
    sourceFile,
    exportName = 'schema',
    tableName,
    tsconfigPath,
    imports = [],
    headerComment
  } = options;
  let outputPath = options.outputPath;

  
  // Resolve source file path
  const sourceFilePath = pathSync.resolve(sourceFile);
  if (!fsSync.existsSync(sourceFilePath)) {
    throw new Error(`Source file not found: ${sourceFilePath}`);
  }

  // Handle outputPath: if not provided, use default; if provided, check if it's a directory
  if (!outputPath) {
    let g = pathSync.join(pathSync.dirname(sourceFilePath), 'generated');
    if (!fsSync.existsSync(g)){
      fsSync.mkdirSync(g, { recursive: true });
    }
    outputPath = pathSync.join(g, 'generated-types.ts');
  } else {
    // Resolve the output path
    outputPath = pathSync.resolve(outputPath);
    
    // Check if outputPath is a directory (exists and is a directory, or doesn't exist and has no extension)
    const isDirectory = fsSync.existsSync(outputPath) 
      ? fsSync.statSync(outputPath).isDirectory()
      : !pathSync.extname(outputPath); // If doesn't exist, treat as directory if no extension
    
    if (isDirectory) {
      // Ensure directory exists
      if (!fsSync.existsSync(outputPath)) {
        fsSync.mkdirSync(outputPath, { recursive: true });
      }
      // Join with default filename
      outputPath = pathSync.join(outputPath, 'generated-types.ts');
    }
  }
  
  // Find tsconfig.json if not provided
  let resolvedTsconfigPath = tsconfigPath;
  if (!resolvedTsconfigPath) {
    let currentDir = pathSync.dirname(sourceFilePath);
    const rootDir = pathSync.parse(currentDir).root; // Get filesystem root
    
    // Search upward from source file directory
    while (currentDir !== rootDir && currentDir !== pathSync.dirname(currentDir)) {
      const candidate = pathSync.join(currentDir, 'tsconfig.json');
      if (fsSync.existsSync(candidate)) {
        resolvedTsconfigPath = candidate;
        break;
      }
      currentDir = pathSync.dirname(currentDir);
    }
    
    // If still not found, try to find in common locations
    if (!resolvedTsconfigPath) {
      const sourceDir = pathSync.dirname(sourceFilePath);
      const projectRoot = sourceDir.includes('examples') 
        ? pathSync.resolve(sourceDir, '../../') 
        : pathSync.resolve(sourceDir, '../');
      
      // Try project root
      const rootCandidate = pathSync.join(projectRoot, 'tsconfig.json');
      if (fsSync.existsSync(rootCandidate)) {
        resolvedTsconfigPath = rootCandidate;
      } else {
        // Try packages/xpdb-schema/tsconfig.json as fallback
        const packageCandidate = pathSync.join(projectRoot, 'packages', 'xpdb-schema', 'tsconfig.json');
        if (fsSync.existsSync(packageCandidate)) {
          resolvedTsconfigPath = packageCandidate;
        }
      }
    }
    
    if (!resolvedTsconfigPath) {
      throw new Error(
        'Could not find tsconfig.json. Please provide tsconfigPath option.\n' +
        `Searched from: ${pathSync.dirname(sourceFilePath)}\n` +
        'You can create a tsconfig.json in your project root or pass tsconfigPath option.'
      );
    }
  }
  
  // Create temporary directory for type extraction
  const tempDir = pathSync.join(pathSync.dirname(outputPath), '.temp-types');
  if (!fsSync.existsSync(tempDir)) {
    fsSync.mkdirSync(tempDir, { recursive: true });
  }
  
  try {
    // Create ts-morph project
    const project = new Project({
      tsConfigFilePath: resolvedTsconfigPath,
    });
    
    const typeChecker = project.getTypeChecker();
    
    // Create temporary file with type references
    const tempFilePath = await createTempTypeFile(sourceFilePath, exportName, tempDir, tableName);
    
    // Extract and expand types
    const typeResults = extractTypes(tempFilePath, sourceFilePath, exportName, project, typeChecker, tableName);
    
    // Generate output file content
    const outputDir = pathSync.dirname(outputPath);
    if (!fsSync.existsSync(outputDir)) {
      fsSync.mkdirSync(outputDir, { recursive: true });
    }
    
    let fileContent = headerComment || `/**
 * Generated Type Declarations
 * 
 * This file is auto-generated. Do not edit manually.
 * 
 * Generated at: ${new Date().toISOString()}
 */

`;
    
    // Add imports
    if (imports.length > 0) {
      fileContent += imports.map(imp => `import ${imp};`).join('\n') + '\n\n';
    }
    
    // Generate type declarations
    if (tableName) {
      // Single table
      const typeName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
      const result = Array.isArray(typeResults) ? typeResults[0] : undefined;
      
      const relativeSourcePath = pathSync.relative(outputDir, sourceFilePath).replace(/\\/g, '/').replace(/\.ts$/, '');
      const selectTypeDef = result?.select 
        ? result.select 
        : `typeof import('${relativeSourcePath}').${exportName === 'default' ? 'default' : exportName}['$inferSelect']`;
      
      const insertTypeDef = result?.insert 
        ? result.insert 
        : `typeof import('${relativeSourcePath}').${exportName === 'default' ? 'default' : exportName}['$inferInsert']`;
      
      fileContent += `/**
 * ${typeName}TableRecord - Record type for ${tableName} table
 */
export type ${typeName}TableRecord = ${selectTypeDef};

/**
 * ${typeName}TableInsert - Insert type for ${tableName} table
 */
export type ${typeName}TableInsert = ${insertTypeDef};

`;
    } else {
      // Schema - generate types for all tables
      if (typeResults instanceof Map) {
        for (const [name, result] of typeResults.entries()) {
          const typeName = name.charAt(0).toUpperCase() + name.slice(1);
          const relativeSourcePath = pathSync.relative(outputDir, sourceFilePath).replace(/\\/g, '/').replace(/\.ts$/, '');
          
          const selectTypeDef = result.select 
            ? result.select 
            : `typeof import('${relativeSourcePath}').${exportName === 'default' ? 'default' : exportName}['tables']['${name}']['$inferSelect']`;
          
          const insertTypeDef = result.insert 
            ? result.insert 
            : `typeof import('${relativeSourcePath}').${exportName === 'default' ? 'default' : exportName}['tables']['${name}']['$inferInsert']`;
          
          fileContent += `/**
 * ${typeName}TableRecord - Record type for ${name} table
 */
export type ${typeName}TableRecord = ${selectTypeDef};

/**
 * ${typeName}TableInsert - Insert type for ${name} table
 */
export type ${typeName}TableInsert = ${insertTypeDef};

`;
        }
      }
    }
    
    // Write output file
    fsSync.writeFileSync(outputPath, fileContent);
    
    // Clean up temporary files
    if (fsSync.existsSync(tempFilePath)) {
      fsSync.unlinkSync(tempFilePath);
    }
    if (fsSync.existsSync(tempDir)) {
      try {
        fsSync.rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
    
    const result = tableName 
      ? (Array.isArray(typeResults) ? typeResults[0] : {})
      : {};
    const expanded = result.select !== undefined || result.insert !== undefined;
    
    return {
      types: result,
      expanded,
      outputPath
    };
  } catch (error) {
    // Clean up on error
    if (fsSync.existsSync(tempDir)) {
      try {
        fsSync.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}




export async function tryGenerateTypes(options: GenerateTypesOptions) {

    console.log('🔍 Generating types from schema...');
    console.log(`Using ${options.sourceFile} export ${options.exportName ?? 'schema'}` + (options.tableName?`table ${options.tableName}`:''));

    try {
        // Generate types for the entire schema
        return await generateTypes(options);

    } catch (error) {
        console.error('❌ Error generating types:', error);
        if (error instanceof Error) {
            console.error(error.stack);
        }

    }
}


export function genTypesScript(filename: string, dst?: string) {
    return tryGenerateTypes({sourceFile: filename, outputPath: dst}).then(r => {
        if (!r) process.exit(1);
        return r;
    }, e => process.exit(1))
}