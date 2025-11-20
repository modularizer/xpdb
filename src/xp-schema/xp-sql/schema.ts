/**
 * Schema Object
 * 
 * Takes a record of tables (bound or unbound) and provides:
 * - Property access to tables
 * - .bind() method to bind all tables to a dialect
 * - .connect() method to connect to a database
 */

import type { SQLDialect} from './dialects/types';
import type { UTable} from './dialects/implementations/unbound';
import { bindTable } from './dialects/implementations/unbound';
import {connect, XPDatabaseConnection} from "./connection";
import {DbConnectionInfo} from "./drivers/types";
import {Table} from "drizzle-orm";
import {getDialectFromName} from "./dialects";

/**
 * Schema with tables exposed as properties
 * This type allows tables to be accessed as properties (e.g., schema.users, schema.posts)
 */
export type SchemaWithTables<Tables extends Record<string, UTable<any> | Table>> =
  Schema<Tables> & {
    readonly [K in keyof Tables]: Tables[K];
  };

/**
 * Schema object that holds tables as properties
 */
export class Schema<Tables extends Record<string, UTable<any> | Table> = Record<string, UTable<any> | Table>> {
  [key: string]: any; // Allow table access via index signature
  
  constructor(public tables: Tables) {
    // Set tables as properties for direct access
    // TypeScript types are provided by the SchemaWithTables type
    for (const [key, table] of Object.entries(tables)) {
      (this as any)[key] = table;
    }
  }

  bindByDialectName(dialectName: string): Promise<SchemaWithTables<Record<keyof Tables, Table>>> {
      return getDialectFromName(dialectName).then(dialect => this.bind(dialect))
  }

  /**
   * Bind all tables in the schema to a dialect
   * Returns a new schema with bound tables
   */
  bind(dialect: SQLDialect): SchemaWithTables<Record<keyof Tables, Table>> {
    const boundTables = {} as Record<keyof Tables, Table>;

    for (const [key, table] of Object.entries(this.tables)) {
      boundTables[key as keyof Tables] = bindTable(table, dialect) as Table;
    }
    
    return new Schema(boundTables) as SchemaWithTables<Record<keyof Tables, Table>>;
  }

  /**
   * Connect to a database using connection info
   * Automatically detects the dialect and driver from connection info
   * Returns a database connection with bound tables
   */
  async connect<T extends DbConnectionInfo>(
    connectionInfo: T
  ): Promise<XPDatabaseConnection> {
    return connect(connectionInfo);
  }

}

/**
 * Create a schema from a record of tables
 * 
 * @param tables - Record of table name to table object (unbound or bound)
 * @returns Schema object with tables as properties
 * 
 * @example
 * ```typescript
 * import { schema } from './xp/schema';
 * import { table, text, uuidPK } from './xp/dialects/implementations/unbound';
 * 
 * const mySchema = schema({
 *   users: table('users', {
 *     id: uuidPK('id'),
 *     name: text('name').notNull(),
 *   }),
 * });
 * 
 * // Access tables as properties
 * const users = mySchema.users;
 * 
 * // Bind to a dialect
 * const boundSchema = mySchema.bind(dialect);
 * 
 * // Connect to database
 * const { db, schema: connectedSchema } = await mySchema.connect({ name: 'my-db' });
 * 
 * ```
 */
export function xpschema<Tables extends Record<string, UTable<any> | Table>>(
  tables: Tables
): SchemaWithTables<Tables> {
  return new Schema(tables) as SchemaWithTables<Tables>;
}

