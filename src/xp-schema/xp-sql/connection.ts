/**
 * Database Wrapper with Lazy Binding
 * 
 * Wraps a Drizzle database connection and provides lazy binding of unbound tables.
 * When an unbound table is used with query methods, it's automatically bound to
 * the database's dialect at that moment.
 */

import type {SQL, Table} from 'drizzle-orm';
import type {
  DbConnectionInfo, 
  DrizzleDatabaseConnectionDriver, 
  DrizzleTable, 
  QueryResult, 
  InitialSelectQueryBuilder, 
  SelectQueryBuilder
} from './drivers/types';

// Import InferTableSelect to ensure we use the exact same type as the interface
// We need to use a type import to get the type
type InferTableSelect<TTable> = 
  TTable extends { $inferSelect: infer T } 
    ? T 
    : Record<string, unknown>;
import type { SQLDialect } from './dialects/types';
import {isUTable, bindTable, UTable} from './dialects/implementations/unbound';
import {connectToDriver} from "./drivers/options";
import {getDialectFromName} from "./dialects/options";


export async function connect(connInfo: DbConnectionInfo): Promise<XPDatabaseConnection> {
    const driver = await connectToDriver(connInfo);
    if (!driver.dialectName) {
        throw new Error(`Driver missing dialectName. Driver: ${JSON.stringify({ dialectName: driver.dialectName, driverName: driver.driverName, hasDialectName: 'dialectName' in driver })}`);
    }
    const dialect = await getDialectFromName(driver.dialectName);
    return new XPDatabaseConnection(driver, dialect);
}

/**
 * Database wrapper that knows its dialect and binds unbound tables
 */
export class XPDatabaseConnection {
  private tableCache = new Map<UTable<any>, Table>();

  constructor(
    public db: DrizzleDatabaseConnectionDriver,
    public dialect: SQLDialect
  ) {}

  /**
   * Get the underlying Drizzle database connection
   */
  get raw(): any {
    return this.db.raw;
  }

  /**
   * Bind an unbound table to this database's dialect
   * Caches the result so subsequent uses are fast
   */
  _bindTable<T extends UTable<any> | Table>(table: T): Table {
    // If already bound, bindTable will return it as-is (or throw if dialect mismatch)
    // We only cache unbound tables
    if (isUTable(table)) {
      // Check cache
      if (this.tableCache.has(table)) {
        return this.tableCache.get(table)!;
      }

      // Bind the table (bindTable handles all the logic)
      const boundTable = bindTable(table, this.dialect);
      this.tableCache.set(table, boundTable);

      return boundTable;
    }

    // Already bound - bindTable will handle dialect checking
    return bindTable(table, this.dialect);
  }

  /**
   * Execute raw SQL
   */
  execute(query: SQL): Promise<QueryResult> {
    return this.db.execute(query);
  }

  /**
   * Start a SELECT query
   * Automatically binds unbound tables when used
   * Preserves type inference from tables via $inferSelect
   */
  select<TSelection extends Record<string, any> | any[] | undefined = undefined>(
    columns?: TSelection
  ): InitialSelectQueryBuilder<TSelection> {
    return this.db.select(columns);
  }

  /**
   * Start an INSERT query
   * Automatically binds unbound tables when used
   */
  insert<TTable extends DrizzleTable | UTable<any>, TRow extends Record<string, any> = Record<string, any>>(
    table: TTable
  ) {
    const boundTable = this._bindTable(table as any);
    return this.db.insert(boundTable as any);
  }

  /**
   * Start an UPDATE query
   * Automatically binds unbound tables when used
   */
  update<TTable extends DrizzleTable | UTable<any>, TRow extends Record<string, any> = Record<string, any>>(
    table: TTable
  ) {
    const boundTable = this._bindTable(table as any);
    return this.db.update(boundTable as any);
  }

  /**
   * Start a DELETE query
   * Automatically binds unbound tables when used
   */
  delete<TTable extends DrizzleTable | UTable<any>>(
    table: TTable
  ) {
    const boundTable = this._bindTable(table as any);
    return this.db.delete(boundTable as any);
  }

  /**
   * Start a transaction
   * The transaction handler receives a database wrapper with the same dialect
   */
  transaction<T = unknown>(
    handler: (tx: XPDatabaseConnection) => Promise<T>
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Create a wrapper for the transaction database
      const txWrapper = new XPDatabaseConnection(tx as any, this.dialect);
      return handler(txWrapper);
    });
  }

  /**
   * Close the database connection
   */
  close(): Promise<void> {
    return this.db.close();
  }
}





