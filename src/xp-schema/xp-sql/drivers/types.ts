import type { SQL } from "drizzle-orm";
import {PlatformCompatibility} from "../../platform";

/**
 * Table type - represents any Drizzle table
 * (pgTable, sqliteTable, mysqlTable, etc.)
 */
export type DrizzleTable = {
    _: {
        name: string;
        schema: string | undefined;
        // Drizzle tables carry additional metadata here;
        // we don't need to model it exactly.
        [key: string]: any;
    };
    [key: string]: any;
};

/**
 * Basic row type (can be narrowed per-query)
 */
export type QueryResultRow = Record<string, unknown>;

/**
 * Extract the inferred select type from a table
 * Works with both Drizzle tables and UTable
 */
export type InferTableSelect<TTable> = 
    TTable extends { $inferSelect: infer T } 
        ? T 
        : QueryResultRow;

/**
 * Column metadata from query result
 */
export interface QueryResultColumn {
    name: string;
    dataType?: string;
    nullable?: boolean;
}

/**
 * Generic query result with consistent format across all drivers
 * Includes rows array and optional metadata (column descriptions, etc.)
 */
export interface QueryResult<T = QueryResultRow> {
    rows: T[];
    columns?: QueryResultColumn[];
    rowCount?: number;
    affectedRows?: number;
}


export interface InitialSelectQueryBuilder<TSelection = undefined> {
    /**
     * Add a table to the FROM clause
     * Infers the row type from the table's $inferSelect property
     * Works with both DrizzleTable and UTable (unbound tables)
     */
    from<TTable extends DrizzleTable | { $inferSelect: any }>(
        table: TTable
    ): SelectQueryBuilder<InferTableSelect<TTable>>;
}
/**
 * Select query builder - returned by db.select(...)
 *
 * T = row type the query resolves to
 */
export interface SelectQueryBuilder<T = QueryResultRow> {
    /**
     * Add a table to the FROM clause (or change the FROM table)
     * Can be called multiple times for subqueries or table aliases
     * When called, updates the inferred row type to match the new table
     * Works with both DrizzleTable and UTable (unbound tables)
     */
    from<TTable extends DrizzleTable | { $inferSelect: any }>(
        table: TTable
    ): SelectQueryBuilder<InferTableSelect<TTable>>;

    where(condition: SQL | undefined): SelectQueryBuilder<T>;

    innerJoin<TTable extends DrizzleTable>(
        table: TTable | any,
        condition: SQL
    ): SelectQueryBuilder<T>;

    leftJoin<TTable extends DrizzleTable>(
        table: TTable | any,
        condition: SQL
    ): SelectQueryBuilder<T>;

    // These are mainly for Postgres-style dialects;
    // they may not be supported by all engines.
    rightJoin<TTable extends DrizzleTable>(
        table: TTable | any,
        condition: SQL
    ): SelectQueryBuilder<T>;

    fullJoin<TTable extends DrizzleTable>(
        table: TTable | any,
        condition: SQL
    ): SelectQueryBuilder<T>;

    limit(count: number): SelectQueryBuilder<T>;

    offset(count: number): SelectQueryBuilder<T>;

    orderBy(...columns: any[]): SelectQueryBuilder<T>;

    groupBy(...columns: any[]): SelectQueryBuilder<T>;

    having(condition: SQL): SelectQueryBuilder<T>;

    /**
     * Thenable – Drizzle builders are promises
     * that resolve to an array of rows (not a QueryResult object).
     */
    then<TResult1 = T[], TResult2 = never>(
        onfulfilled?:
            | ((value: T[]) => TResult1 | PromiseLike<TResult1>)
            | undefined
            | null,
        onrejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | undefined
            | null
    ): Promise<TResult1 | TResult2>;
}


/**
 * Insert query builder - returned by db.insert(table)
 *
 * TTable = table type (for metadata)
 * TRow   = inserted row type (very roughly)
 */
export interface InsertQueryBuilder<
    TTable extends DrizzleTable,
    TRow extends QueryResultRow = QueryResultRow
> {
    values(
        values: Record<string, any> | Record<string, any>[]
    ): InsertQueryBuilder<TTable, TRow>;

    onConflictDoUpdate(config: {
        target: any | any[];
        set: Partial<Record<string, any>>;
    }): InsertQueryBuilder<TTable, TRow>;

    onConflictDoNothing(
        target?: any | any[]
    ): InsertQueryBuilder<TTable, TRow>;

    /**
     * Return inserted rows (if supported by dialect)
     */
    returning(): SelectQueryBuilder<TRow>;

    /**
     * Thenable – what this resolves to differs
     * between drivers (SQLite vs Postgres, etc.),
     * so we keep it as unknown by default.
     */
    then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
            | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
            | undefined
            | null,
        onrejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | undefined
            | null
    ): Promise<TResult1 | TResult2>;
}

/**
 * Update query builder - returned by db.update(table)
 */
export interface UpdateQueryBuilder<
    TTable extends DrizzleTable,
    TRow extends QueryResultRow = QueryResultRow
> {
    set(values: Partial<Record<string, any>>): UpdateQueryBuilder<TTable, TRow>;

    where(condition: SQL): UpdateQueryBuilder<TTable, TRow>;

    returning(): SelectQueryBuilder<TRow>;

    then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
            | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
            | undefined
            | null,
        onrejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | undefined
            | null
    ): Promise<TResult1 | TResult2>;
}

/**
 * Delete query builder - returned by db.delete(table)
 */
export interface DeleteQueryBuilder<
    TTable extends DrizzleTable,
    TRow extends QueryResultRow = QueryResultRow
> {
    where(condition: SQL): DeleteQueryBuilder<TTable, TRow>;

    returning(): SelectQueryBuilder<TRow>;

    then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
            | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
            | undefined
            | null,
        onrejected?:
            | ((reason: any) => TResult2 | PromiseLike<TResult2>)
            | undefined
            | null
    ): Promise<TResult1 | TResult2>;
}

/**
 * You can hang driver-specific connection info here if you want.
 * Note: dialectName is optional in connection info (input), but will be set
 * when the connection is created.
 */
export interface DbConnectionInfo {
    /**
     * The SQL dialect name (e.g., 'pg', 'sqlite')
     * Optional in connection info input, but always present in the returned connection
     */
    name: string;
    dialectName: string;
    driverName: string;
}

export interface DriverDetails {
    driverName: string;
    dialectName: string;
    clientPlatforms: PlatformCompatibility<boolean>,
    hostPlatforms: PlatformCompatibility<boolean>,
}

/**
 * Cross-driver Drizzle "db" interface
 * (sqlite, pg, pglite, mysql, etc.)
 */
export type DrizzleDatabaseConnectionDriver<T extends DbConnectionInfo = DbConnectionInfo> = {
    connInfo: T;
    raw: any;

    dialectName: string;
    driverName: string;
    clientPlatforms: PlatformCompatibility<boolean>,
    hostPlatforms: PlatformCompatibility<boolean>,

    /**
     * Execute raw SQL (`db.execute(sql\`...\`)`)
     *
     * Return type is driver-specific, so we keep it unknown.
     */
    execute(query: SQL): Promise<QueryResult>;

    /**
     * Start a SELECT query
     * The row type will be inferred from the table passed to .from()
     */
    select<TSelection extends Record<string, any> | any[] | undefined = undefined>(
        columns?: TSelection
    ): InitialSelectQueryBuilder<TSelection>;

    /**
     * Start an INSERT query
     */
    insert<TTable extends DrizzleTable, TRow extends QueryResultRow = QueryResultRow>(
        table: TTable
    ): InsertQueryBuilder<TTable, TRow>;

    /**
     * Start an UPDATE query
     */
    update<TTable extends DrizzleTable, TRow extends QueryResultRow = QueryResultRow>(
        table: TTable
    ): UpdateQueryBuilder<TTable, TRow>;

    /**
     * Start a DELETE query
     */
    delete<TTable extends DrizzleTable, TRow extends QueryResultRow = QueryResultRow>(
        table: TTable
    ): DeleteQueryBuilder<TTable, TRow>;

    /**
     * Transaction – all drivers expose this
     * with a db-like object inside the handler.
     */
    transaction<T = unknown>(
        handler: (tx: DrizzleDatabaseConnectionDriver) => Promise<T>
    ): Promise<T>;

    close(): Promise<void>;

    deleteDatabase(conn: T): Promise<void>;
};



/**
 * Generic "connect" helper type – you can implement
 * per driver (sqlite, pg, pglite, etc.)
 */
export type connectFn<
    T extends DbConnectionInfo = DbConnectionInfo
> = (config: T) => Promise<DrizzleDatabaseConnectionDriver<T>>;




export interface XPDriverImpl extends DriverDetails{
    connect: <T extends DbConnectionInfo = DbConnectionInfo>(config: T) => Promise<DrizzleDatabaseConnectionDriver<T>>
}


