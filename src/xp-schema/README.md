# xpdb-schema

Core schema system for xp-deeby. Provides database connections, schema definitions, filters, and key-value storage across multiple platforms (web, mobile, node).

This module serves as the foundation for database operations in xp-deeby, abstracting away platform-specific details and providing a unified API for working with different database backends. It includes support for both SQL databases (via xp-sql) and key-value storage, along with a flexible filtering system for querying data.

## Usage

```typescript
import {connect, xpschema, createOrSaveRegistryEntry, table, text, timestamp, generateUUID} from 'xpdb-schema';

// Step 1: Define custom column builders
const uuid = (name: string) => varchar(name, {length: 16}).default(generateUUID);


// Step 2: Define Schema
const usersTable = table('users', {
    id: uuid('id').primaryKey(),
    name: text('name').primaryKey(),
    birthday: timestamp('birthday'),
    gender: varchar('gender', {enum: ['male', 'female']}),
    bio: text('bio'),
    headline: varchar('headline', {length: 20})
});

const postsTable = table('posts', {
    author: text('name').notNull().references(() => usersTable.name),
    postedAt: timestamp('posted_at').defaultNow(),
    content: varchar('content', 2000),
})

// Step 3: Define Schema
const schema = xpschema({
    users: usersTable,
    posts: postsTable
});

// Step 4: Define the params to connect to a database
const connInfo = await createOrSaveRegistryEntry({
    name: 'my-db',
    driverName: 'pglite',
    dialectName: 'pg'
});

// Step 5: get a connection, this will auto-bind the tables to the correct dialect
const db = schema.connect(connInfo);


// Step 6: use it!
// db.users.insert

```
