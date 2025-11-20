# implementations

Concrete driver implementations: PGLite, Postgres, and SQLite Mobile. Each driver handles the low-level connection and query execution for its specific database backend.

These implementations wrap the actual database libraries (PGLite, node-postgres, better-sqlite3) and provide a consistent interface through the DrizzleDatabaseConnectionDriver type. They handle connection management, query execution, and result formatting.

## Usage

```typescript
import { PGLiteDriver } from './implementations/pglite';
import { PostgresDriver } from './implementations/postgres';
import { SQLiteMobileDriver } from './implementations/sqlite-mobile';

// Create driver instance
const driver = new PGLiteDriver({ path: './data' });
await driver.connect();

// Execute queries through driver
const result = await driver.raw.select().from(table);
```
