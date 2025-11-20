# xpdb

A monorepo containing cross-platform and cross-dialect database tools for TypeScript/JavaScript.

## Goal
The primary goal of this package is making it easy to manage 
- **offline-first** local-storage for cross-platform apps
- **syncing** data to-from application databases to offline local caches
- **working across dialects** using the same code

`drizzle-orm` is **fantastic**. For any complex use cases, lean into using drizzle directly...  but for simple schemas, I was frustrated that small differences in implementations made it tough to share code for different dialects.

## Packages

This repository contains two main packages:

### [`xpdb-schema`](./packages/xpdb-schema)

**Cross-platform database schema builder** - Define your schema once and use it across multiple SQL dialects and implementations.

- 🎯 Define once, use everywhere
- 🔄 Automatic dialect binding
- 🚀 Full TypeScript support
- 📦 Cross-platform (Node.js, Web, Mobile)

[Read the xpdb-schema documentation →](./packages/xpdb-schema/README.md)

### [`xpdb-viewer`](./packages/xpdb-viewer)

**React Native database viewer UI components** - Pre-built components for browsing and querying databases managed with `xpdb-schema`.

- 📊 Table viewer with sorting and filtering
- 🔍 SQL query editor
- 🗂️ Database browser with sidebar navigation
- 📱 Built for React Native and Expo

[Read the xpdb-viewer documentation →](./packages/xpdb-viewer/README.md)

## `xpdb-schema` Features
1. **Shared Schema:**
    - Write the same code to define your schema for...
      - `pglite` (web browser indexeddb storage)
      - `sqlite-mobile` (mobile local storage)
      - `postgres` (application backend).
    - **caveats:** this is meant for **small** and **simple** database schemas, such as ones that SQLite supports. It may eventually support high-complexity, but I plan to add features as needed.
2. **Generation Tools:**
   - Use your schema definition to auto-gen
     - **types** to see the fully expanded `.$inferSelect` and `.$inferInsert` types for each table
     - **create scripts** for each dialect which can be run multiple times
     - **migrations** for each dialect
3. **Runtime Schema Detection:**
   - Auto-detect schema from a database connection
     - Auto-migrate a database you connected to to your current version

## `xpdb-viewer` Features
- Connect to any database
- Browse data
- Run custom queries
- Meant as a viewer, not an admin panel. Don't expect good tools like `pgadmin`, it is just viewing the data and custom select queries



## Quick Start

### Install xpdb-schema

```bash
npm install xpdb-schema
```

### Install xpdb-viewer (optional, for UI components)

```bash
npm install xpdb-viewer
```

## Development

### Building

Each package can be built independently:

```bash
# Build xpdb-schema
cd packages/xpdb-schema
npm run build

# Build xpdb-viewer
cd packages/xpdb-viewer
npm run build
```

### Publishing

Each package is published separately to npm:

```bash
# Publish xpdb-schema
cd packages/xpdb-schema
npm publish

# Publish xpdb-viewer
cd packages/xpdb-viewer
npm publish
```

## Examples

See the [`examples/`](./examples/) directory for usage examples of both packages.

## License

Unlicense
