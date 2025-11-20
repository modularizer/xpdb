# xpdb-schema

**Cross-platform database schema builder** - Define your schema once and use it across multiple SQL dialects and implementations.

Built on top of [Drizzle ORM](https://orm.drizzle.team/), `xpdb-schema` provides a unified API for defining database schemas that can be automatically bound to different SQL dialects (PostgreSQL, SQLite) and implementations (postgres-js, pglite, expo-sqlite) at runtime.

## Features

- 🎯 **Define Once, Use Everywhere** - Write your schema once and use it with any supported database
- 🔄 **Automatic Dialect Binding** - Tables are automatically bound to the correct dialect when connecting
- 🚀 **Type-Safe** - Full TypeScript support with inference for insert, select, and update types
- 📦 **Cross-Platform** - Works on Node.js, Web (browser), and Mobile (React Native/Expo)
- 🔧 **Multiple Drivers** - Support for postgres-js, pglite, and expo-sqlite
- 🗄️ **Migration Support** - Generate and run migrations across different dialects
- 🎨 **Extensible** - Build custom column types and extend the schema builder

## Installation

```bash
npm install xpdb-schema
```

### Module Format Support

This package supports both **ES Modules (ESM)** and **CommonJS (CJS)**:

- **ESM** (default): Use `import` statements - works in modern browsers, React Native, and Node.js 18+
- **CJS**: Use `require()` - works in older Node.js versions and some bundlers

The package automatically provides the correct format based on how you import it:

```javascript
// ESM (modern)
import { xpschema, table, text } from 'xpdb-schema';

// CommonJS (legacy)
const { xpschema, table, text } = require('xpdb-schema');
```

### Peer Dependencies

Depending on which database driver you want to use, install the corresponding peer dependency:

**PostgreSQL (postgres-js):**
```bash
npm install postgres
```

**PGlite (in-browser PostgreSQL):**
```bash
npm install pglite
```

**Expo SQLite (React Native):**
```bash
npm install expo-sqlite expo-file-system
```

## Quick Start

### 1. Define Your Schema

```typescript
import { xpschema, table, text, timestamp, varchar, uuid, generateUUID, getFilename } from 'xpdb-schema';

// Get __filename equivalent for ES modules (needed for schema anchor)
const __filename = getFilename(import.meta.url);

// Define tables using unbound column builders
const usersTable = table('users', {
  id: uuid('id').primaryKey(),
  name: text('name').unique(),
  email: varchar('email', { length: 255 }).notNull(),
  birthday: timestamp('birthday'),
  createdAt: timestamp('created_at').defaultNow(),
});

const postsTable = table('posts', {
  id: uuid('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => usersTable.id),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content'),
  postedAt: timestamp('posted_at').defaultNow(),
});

// Create the schema (__filename is used as anchor for code generation)
export const schema = xpschema({
  users: usersTable,
  posts: postsTable,
}, __filename);
```

### 2. Connect to a Database

```typescript
import { createOrRetrieveRegistryEntry } from 'xpdb-schema';

// Create or retrieve a connection configuration
const connInfo = await createOrRetrieveRegistryEntry({
  name: 'my-database',
  driverName: 'pglite', // or 'postgres', 'sqlite-mobile'
  dialectName: 'pg',    // or 'sqlite'
});

// Connect using the schema
const db = await schema.connect(connInfo);
```

### 3. Use Your Database

```typescript
// Insert data
await db.users.insert({
  id: generateUUID(),
  name: 'Alice',
  email: 'alice@example.com',
  birthday: new Date('1990-01-01'),
});

// Query data
const users = await db.users.select().where(db.users.name.eq('Alice'));

// Update data
await db.users.update({
  name: 'Alice Updated',
}).where(db.users.id.eq(userId));

// Delete data
await db.users.delete().where(db.users.id.eq(userId));
```

## ES Module Support

Since `xpdb-schema` uses ES modules (`"type": "module"`), Node.js globals like `__filename` and `__dirname` are not available. Use the provided helper functions instead:

```typescript
import { getFilename, getDirname, getFileInfo } from 'xpdb-schema';

// Get __filename equivalent
const __filename = getFilename(import.meta.url);

// Get __dirname equivalent
const __dirname = getDirname(import.meta.url);

// Or get both at once
const { __filename, __dirname } = getFileInfo(import.meta.url);
```

The `__filename` is typically used as the anchor parameter when creating a schema, which helps the code generation tools locate your schema file:

```typescript
export const schema = xpschema({
  users: usersTable,
  posts: postsTable,
}, __filename); // Anchor for code generation
```

## Core Concepts

### Unbound Tables and Columns

`xpdb-schema` uses "unbound" tables and columns that are not tied to any specific SQL dialect until they're used with a database connection. This allows you to:

- Define your schema once
- Use it with different database engines
- Get automatic type conversions (e.g., `jsonb` → `text` with JSON mode for SQLite)

### Column Builders

All column builders are exported from the main package:

```typescript
import {
  text,        // Text column
  varchar,     // Variable-length string
  integer,     // Integer
  real,        // Floating point
  timestamp,   // Timestamp
  date,        // Date
  time,        // Time
  boolean,     // Boolean
  jsonb,       // JSON (converts to text in SQLite)
  uuid,        // UUID string
  uuidPK,      // UUID primary key with auto-generation
  blob,        // Binary data
} from 'xpdb-schema';
```

### Custom Column Types

You can create custom column types by extending the base builders:

```typescript
import { text } from 'xpdb-schema';
import { z } from 'zod';

// Create a hex-validated column
const hex = (name: string) => 
  text(name, { mode: 'json' })
    .$type<`0x${string}`>()
    .refine((val) => /^0x[0-9a-f]+$/i.test(val));
```

### Schema Definition

Use `xpschema()` to create a schema from your tables:

```typescript
const schema = xpschema({
  users: usersTable,
  posts: postsTable,
  comments: commentsTable,
});
```

The schema provides:
- Type-safe table access
- Connection management
- Migration generation
- Schema introspection

## Supported Drivers

| Driver | Platform | Dialect | Package |
|--------|----------|---------|---------|
| postgres | Node.js | PostgreSQL | `postgres` |
| pglite | Web | PostgreSQL | `pglite` |
| sqlite-mobile | React Native/Expo | SQLite | `expo-sqlite` |

## Command-Line Tool

`xpdb-schema` includes a CLI tool `xpdb-gen` for generating types, CREATE scripts, and migrations from your schema files.

### Installation

The CLI tool is automatically available when you install `xpdb-schema`:

```bash
npm install xpdb-schema
```

### Usage

```bash
# Look for schema.ts or schema.js in current directory
xpdb-gen

# Specify a schema file
xpdb-gen schema.ts

# Specify output directory
xpdb-gen schema.ts --dst ./generated

# Generate only types (skip CREATE scripts and migrations)
xpdb-gen --no-creates --no-migrations

# Generate CREATE scripts for specific dialects
xpdb-gen --creates pg

# Generate migrations for specific dialects
xpdb-gen --migrations pg,sqlite
```

### Options

- `[schema-file]` - Path to your schema file (default: looks for `schema.ts` or `schema.js` in current directory)
- `--no-types` - Skip generating TypeScript types
- `--no-creates` - Skip generating CREATE scripts
- `--no-migrations` - Skip generating migrations
- `--creates <dialects>` - Comma-separated list of dialects for CREATE scripts (default: `pg,sqlite`)
- `--migrations <dialects>` - Comma-separated list of dialects for migrations (default: all)
- `--dst <directory>` - Output directory (default: `generated/` relative to schema file)
- `-h, --help` - Show help message

### TypeScript Support

For TypeScript schema files (`.ts`), you have a few options:

1. **Compile to JavaScript first** (recommended for production):
   ```bash
   tsc schema.ts
   xpdb-gen schema.js
   ```

2. **Use tsx** (easiest for development):
   ```bash
   npm install -D tsx
   # tsx will handle TypeScript imports automatically
   node --loader tsx node_modules/.bin/xpdb-gen schema.ts
   # Or if xpdb-gen is in your PATH:
   NODE_OPTIONS="--loader tsx" xpdb-gen schema.ts
   ```

3. **Use ts-node with ESM**:
   ```bash
   npm install -D ts-node typescript
   NODE_OPTIONS="--loader ts-node/esm" xpdb-gen schema.ts
   ```

### Example

Given a `schema.ts` file:

```typescript
import { xpschema, table, text, uuid } from 'xpdb-schema';

const usersTable = table('users', {
  id: uuid('id').primaryKey(),
  name: text('name'),
});

export const schema = xpschema({
  users: usersTable,
}, __filename);
```

Run:

```bash
xpdb-gen schema.ts
```

This will generate:
- TypeScript types in `generated/generated-types.ts`
- CREATE scripts for PostgreSQL and SQLite in `generated/`
- Migration files in `generated/migrations/`

## Advanced Usage

### Migrations

Generate migrations from your schema:

```typescript
import { generateMigrations } from 'xpdb-schema';

const migrations = await generateMigrations({
  schema,
  dialect: 'pg',
  // ... options
});
```

### Schema Introspection

Extract schema metadata:

```typescript
import { getSchemaJson } from 'xpdb-schema';

const schemaJson = await getSchemaJson(schema);
```

### Connection Registry

Manage database connections:

```typescript
import {
  getRegistryEntries,
  getRegistryEntry,
  saveRegistryEntry,
  removeRegistryEntry,
} from 'xpdb-schema';

// List all connections
const entries = await getRegistryEntries();

// Get a specific connection
const entry = await getRegistryEntry('my-database');

// Save a connection
await saveRegistryEntry({
  name: 'my-database',
  driverName: 'pglite',
  dialectName: 'pg',
});
```

## TypeScript Support

`xpdb-schema` provides full TypeScript support with type inference:

```typescript
// Infer types from tables
type User = typeof usersTable.$inferSelect;
type NewUser = typeof usersTable.$inferInsert;

// Use with database connection
const user: User = await db.users.select().where(...);
await db.users.insert(newUser: NewUser);
```

## Examples

See the [`examples/`](../../examples/) directory for more examples:

- Basic schema definition and usage
- Migration generation
- Custom column types
- Multi-dialect schemas

## API Reference

### Core Functions

- `xpschema(tables)` - Create a schema from tables
- `table(name, columns, constraints?)` - Create an unbound table
- `connect(connInfo, schema?)` - Connect to a database
- `generateUUID()` - Generate a UUID string

### Column Builders

- `text(name, options?)` - Text column
- `varchar(name, options?)` - Variable-length string
- `integer(name, options?)` - Integer
- `timestamp(name, options?)` - Timestamp
- `uuid(name)` - UUID column
- `jsonb(name)` - JSON column
- ... and more

### Schema Methods

- `schema.connect(connInfo)` - Connect to a database
- `schema.gen()` - Generate TypeScript types and SQL scripts

### Database Methods

- `db.table.insert(data)` - Insert rows
- `db.table.select()` - Query rows
- `db.table.update(data)` - Update rows
- `db.table.delete()` - Delete rows
- `db.table.upsert(data)` - Upsert rows

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Unlicense

