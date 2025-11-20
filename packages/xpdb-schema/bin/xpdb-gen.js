#!/usr/bin/env node

/**
 * xpdb-gen - Command-line tool for generating types, create scripts, and migrations
 * 
 * Usage:
 *   xpdb-gen [schema-file] [options]
 * 
 * If schema-file is not provided, looks for schema.ts or schema.js in current directory.
 * 
 * Options:
 *   --no-types          Skip generating TypeScript types
 *   --no-creates        Skip generating CREATE scripts
 *   --no-migrations     Skip generating migrations
 *   --creates <dialects> Comma-separated list of dialects for CREATE scripts (default: pg,sqlite)
 *   --migrations <dialects> Comma-separated list of dialects for migrations (default: all)
 *   --dst <directory>   Output directory (default: generated/ relative to schema file)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function findSchemaFile(schemaPath) {
  if (schemaPath) {
    // Resolve the provided path
    const resolved = resolve(process.cwd(), schemaPath);
    if (!existsSync(resolved)) {
      throw new Error(`Schema file not found: ${resolved}`);
    }
    return resolved;
  }

  // Look for schema.ts or schema.js in current directory
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'schema.ts'),
    join(cwd, 'schema.js'),
    join(cwd, 'schema.mjs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No schema file found. Please provide a path to your schema file, or ensure schema.ts or schema.js exists in the current directory.\n` +
    `Current directory: ${cwd}`
  );
}

async function importSchema(schemaPath) {
  const isTypeScript = schemaPath.endsWith('.ts') || schemaPath.endsWith('.tsx');
  
  try {
    // Try dynamic import first (for ESM)
    const module = await import(schemaPath);
    
    // Look for default export or named 'schema' export
    if (module.default && typeof module.default.gen === 'function') {
      return module.default;
    }
    if (module.schema && typeof module.schema.gen === 'function') {
      return module.schema;
    }
    
    // Check all exports for a schema object
    for (const [key, value] of Object.entries(module)) {
      if (value && typeof value.gen === 'function') {
        return value;
      }
    }
    
    throw new Error(
      `No schema object found in ${schemaPath}. ` +
      `Expected a default export or named export 'schema' with a .gen() method.`
    );
  } catch (error) {
    // Handle TypeScript import errors
    if (isTypeScript && (error.code === 'ERR_UNKNOWN_FILE_EXTENSION' || 
                         error.message.includes('Cannot find module') ||
                         error.message.includes('Unknown file extension'))) {
      throw new Error(
        `Cannot import TypeScript file directly: ${schemaPath}\n` +
        `\n` +
        `Options:\n` +
        `1. Compile TypeScript to JavaScript first, then run:\n` +
        `   xpdb-gen schema.js\n` +
        `\n` +
        `2. Use tsx to run the command:\n` +
        `   npx tsx -r xpdb-gen schema.ts\n` +
        `   (or install tsx: npm install -D tsx)\n` +
        `\n` +
        `3. Use ts-node with ESM support:\n` +
        `   NODE_OPTIONS="--loader ts-node/esm" xpdb-gen schema.ts\n` +
        `   (requires: npm install -D ts-node typescript)`
      );
    }
    
    if (error.code === 'ERR_UNKNOWN_FILE_EXTENSION' || error.message.includes('Cannot find module')) {
      // Try using require for CommonJS
      try {
        const require = createRequire(import.meta.url);
        const module = require(schemaPath);
        
        if (module.default && typeof module.default.gen === 'function') {
          return module.default;
        }
        if (module.schema && typeof module.schema.gen === 'function') {
          return module.schema;
        }
        
        for (const [key, value] of Object.entries(module)) {
          if (value && typeof value.gen === 'function') {
            return value;
          }
        }
        
        throw new Error(
          `No schema object found in ${schemaPath}. ` +
          `Expected a default export or named export 'schema' with a .gen() method.`
        );
      } catch (requireError) {
        throw new Error(
          `Failed to import schema from ${schemaPath}: ${requireError.message}\n` +
          `Original error: ${error.message}`
        );
      }
    }
    throw error;
  }
}

function parseDialects(value) {
  if (!value || value === 'true' || value === 'all') {
    return true;
  }
  if (value === 'false' || value === 'none') {
    return false;
  }
  return value.split(',').map(d => d.trim()).filter(Boolean);
}

function parseOptions(args) {
  const options = {
    types: true,
    creates: ['pg', 'sqlite'],
    migrations: true,
    dst: undefined,
  };

  let schemaPath = null;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--no-types') {
      options.types = false;
    } else if (arg === '--no-creates') {
      options.creates = false;
    } else if (arg === '--no-migrations') {
      options.migrations = false;
    } else if (arg === '--creates') {
      i++;
      if (i >= args.length) {
        throw new Error('--creates requires a value');
      }
      options.creates = parseDialects(args[i]);
    } else if (arg === '--migrations') {
      i++;
      if (i >= args.length) {
        throw new Error('--migrations requires a value');
      }
      options.migrations = parseDialects(args[i]);
    } else if (arg === '--dst') {
      i++;
      if (i >= args.length) {
        throw new Error('--dst requires a value');
      }
      options.dst = resolve(process.cwd(), args[i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
xpdb-gen - Generate types, CREATE scripts, and migrations from your schema

Usage:
  xpdb-gen [schema-file] [options]

If schema-file is not provided, looks for schema.ts or schema.js in current directory.

Options:
  --no-types              Skip generating TypeScript types
  --no-creates            Skip generating CREATE scripts
  --no-migrations         Skip generating migrations
  --creates <dialects>    Comma-separated list of dialects for CREATE scripts
                         (default: pg,sqlite)
                         Use 'all' or 'true' for all dialects
                         Use 'false' or 'none' to disable
  --migrations <dialects> Comma-separated list of dialects for migrations
                         (default: all)
                         Use 'all' or 'true' for all dialects
                         Use 'false' or 'none' to disable
  --dst <directory>      Output directory
                         (default: generated/ relative to schema file)
  -h, --help             Show this help message

Examples:
  xpdb-gen
  xpdb-gen schema.ts
  xpdb-gen ./src/schema.ts --dst ./generated
  xpdb-gen --no-migrations --creates pg
  xpdb-gen --migrations pg,sqlite
`);
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      // Positional argument - schema file path
      if (schemaPath) {
        throw new Error(`Unexpected argument: ${arg}`);
      }
      schemaPath = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    i++;
  }

  return { schemaPath, options };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const { schemaPath, options } = parseOptions(args);

    // Find schema file
    const schemaFile = await findSchemaFile(schemaPath);
    console.log(`📄 Found schema file: ${schemaFile}`);

    // Import schema
    console.log(`📦 Importing schema...`);
    const schema = await importSchema(schemaFile);
    console.log(`✅ Schema imported successfully`);

    // Determine source and destination
    const src = schemaFile;
    const dst = options.dst || join(dirname(schemaFile), 'generated');

    // Call gen() method
    console.log(`🚀 Generating files...`);
    console.log(`   Source: ${src}`);
    console.log(`   Destination: ${dst}`);
    console.log(`   Types: ${options.types ? 'yes' : 'no'}`);
    console.log(`   CREATE scripts: ${options.creates ? (Array.isArray(options.creates) ? options.creates.join(', ') : 'all') : 'no'}`);
    console.log(`   Migrations: ${options.migrations ? (Array.isArray(options.migrations) ? options.migrations.join(', ') : 'all') : 'no'}`);

    await schema.gen({
      src,
      dst,
      types: options.types,
      creates: options.creates,
      migrations: options.migrations,
    });

    console.log(`✅ Generation complete!`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

