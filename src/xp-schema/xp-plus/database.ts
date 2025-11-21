/**
 * Base Adapter Class
 *
 * Abstract base class that provides common implementations for all adapters.
 * Subclasses must implement abstract methods, and can use the concrete methods.
 */
import {and, count, eq, isNull, notInArray, sql} from 'drizzle-orm';
import type { SQL, Table } from 'drizzle-orm';


import {XPDatabaseConnection} from "../xp-sql/connection";
import {
    DbConnectionInfo, DeleteQueryBuilder, type DrizzleDatabaseConnectionDriver,
    DrizzleTable,
    InsertQueryBuilder,
    QueryResult,
    SelectQueryBuilder, UpdateQueryBuilder
} from "../xp-sql/drivers/types";
import {XPDatabaseTablePlus, XPDatabaseTablePlusWithColumns} from "./table";
import type {SQLDialect} from "../xp-sql/dialects/types";
import {connectToDriver} from "../xp-sql/drivers/options";
import {getDialectFromName} from "../xp-sql/dialects/options";
import {getSchemaJsonFromBoundTables} from "../xp-sql/utils/schema-extraction/extract-schema-metadata";
import {extractRuntimeSchemaMetadata} from "../xp-sql/utils/schema-extraction/extract-runtime-metadata";
import {compareTables, type SchemaDiff} from "../xp-sql/utils/schema-extraction/schema-diff";
import {generateMigrationFromSnapshotDiff, type SchemaSnapshot} from "../xp-sql/utils/sql-generation/snapshot-sql-generator";
import {bindTable, isUTable, type UTable} from "../xp-sql/dialects/implementations/unbound";
import {createOrRetrieveRegistryEntry} from "../registry-storage";



export function isRecord(obj: unknown): obj is Record<string, any> {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        return false;
    }

    return Object.keys(obj).every(key => typeof key === "string");
}


export type ResolvedCondition = SQL | Record<string, any> | SQL[];
export type UnresolvedCondition = string | string[];
export type Condition = ResolvedCondition | UnresolvedCondition;

export type UpsertActionType = 'inserted' | 'updated' | 'unchanged';

export const UpsertAction = 'upsert-action';

/**
 * Type helper to extract column properties from UTable
 * UTable has columns as direct properties (e.g., table.id, table.name)
 * We exclude only the known internal UTable properties
 */
type ExtractUTableColumns<T> = T extends { [K: string]: any }
    ? {
        readonly [K in keyof T as K extends 
            'columns' | '__unbound' | '__name' | '$inferSelect' | '$inferInsert' | '$primaryKey' | 'constraints'
            ? never 
            : K]: T[K];
    }
    : {};

/**
 * Type helper to extract columns from bound Table
 * Bound Table has columns in _['columns']
 */
type ExtractTableColumns<T> = T extends Table
    ? T['_']['columns']
    : {};

/**
 * Type helper to map schema tables to XPDatabaseTablePlus instances
 * Preserves the original table types (UTable or Table) to maintain type information
 */
export type XPDatabaseConnectionPlusWithTables<TTables extends Record<string, Table | any> = Record<string, Table>> =
    XPDatabaseConnectionPlus & {
        readonly [K in keyof TTables]: XPDatabaseTablePlusWithTable<TTables[K]>;
    };

/**
 * Type helper to create XPDatabaseTablePlus with columns from the original table type
 * For UTable, extracts columns from the table structure itself (columns are properties)
 * For bound Table, uses the _['columns'] structure
 */
type XPDatabaseTablePlusWithTable<TTable> = 
    XPDatabaseTablePlus & 
    (TTable extends Table
        ? ExtractTableColumns<TTable>     // Bound Table structure
        : ExtractUTableColumns<TTable>);   // UTable structure (everything else)

export async function connect<TTables extends Record<string, Table | any> = Record<string, Table>>(
    connInfo: DbConnectionInfo, 
    schema?: TTables | string
): Promise<XPDatabaseConnectionPlusWithTables<TTables>> {
    const driver = await connectToDriver(connInfo);
    const dialectName = driver.dialectName;
    const dialect = await getDialectFromName(dialectName);
    
    // Ensure connection info includes dialectName and driverName from the driver
    const fullConnInfo: DbConnectionInfo = {
        ...connInfo,
        dialectName: driver.dialectName,
        driverName: driver.driverName,
    };
    
    // Automatically save connection info to registry
    await createOrRetrieveRegistryEntry(fullConnInfo);
    
    return new XPDatabaseConnectionPlus(driver, dialect, schema) as XPDatabaseConnectionPlusWithTables<TTables>;
}

export class XPDatabaseConnectionPlus<TTables extends Record<string, Table> = Record<string, Table>> extends XPDatabaseConnection {
    tables: Record<string, XPDatabaseTablePlus> = {};
    schema: Record<string, Table> = {};
    schemaPromise: Promise<void>;


    constructor(
        db: DrizzleDatabaseConnectionDriver,
        dialect: SQLDialect,
        schema?: TTables | string
    ) {
        super(db, dialect);
        this.schemaPromise = this.registerSchema(schema as any);
    }

    registerSchema(schema?: Record<string, Table> | string): Promise<void> {
        if (!schema) {
            return this.detectRuntimeSchema().then((detectedSchema) => {
                console.log('[XPDatabaseConnectionPlus] Detected runtime schema:', Object.keys(detectedSchema));
                return this.registerSchema(detectedSchema);
            });
        }else if (typeof schema === "string"){
            return this.detectRuntimeSchema(schema).then((detectedSchema) => {
                console.log(`[XPDatabaseConnectionPlus] Detected runtime schema (${schema}):`, Object.keys(detectedSchema));
                return this.registerSchema(detectedSchema);
            });
        }
        
        // Bind all unbound tables to the dialect before storing
        // This ensures this.schema always contains bound Drizzle tables
        // First pass: bind all tables (FKs will be deferred)
        const boundSchema: Record<string, Table> = {};
        const unboundSchema: Record<string, UTable<any> | Table> = schema;
        
        // Create a registry to map unbound tables to bound tables for FK resolution
        const tableRegistry = new Map<UTable<any>, Table>();
        
        for (const [tableName, table] of Object.entries(schema)) {
            // Store unbound table in registry before binding
            if (isUTable(table)) {
                // We'll populate the registry after binding
            }
            const boundTable = bindTable(table, this.dialect, tableRegistry);
            if (isUTable(table)) {
                tableRegistry.set(table, boundTable);
            }
            boundSchema[tableName] = boundTable;
            
            const config = this.dialect.getTableConfig(boundTable);
            if (!config || !config.columns || typeof config.columns !== 'object') {
                throw new Error(
                    `Table "${tableName}" binding failed: getTableConfig returned invalid config. ` +
                    `Expected config.columns to be an object, got ${typeof config?.columns}`
                );
            }
            
            boundSchema[tableName] = boundTable;
        }
        
        // Store bound tables
        this.schema = boundSchema;
        
        // Create XPDatabaseTablePlus wrappers for each table
        for (let [tableName, table] of Object.entries(boundSchema)) {
            this.tables[tableName] = this.getTable(table);
            //@ts-ignore
            this[tableName] = this.getTable(table);
        }
        
        // After schema is registered, detect runtime schema and compare
        this.detectRuntimeSchema().then(async (runtimeSchema) => {
            const runtimeTableNames = Object.keys(runtimeSchema);
            const schemaTableNames = Object.keys(boundSchema);
            
            console.log('[XPDatabaseConnectionPlus] Runtime schema detected:', runtimeTableNames);
            console.log('[XPDatabaseConnectionPlus] Target schema (passed in):', schemaTableNames);
            
            const targetMetadata = await getSchemaJsonFromBoundTables(boundSchema, this.dialect.dialectName as 'sqlite' | 'pg');
            const liveMetadata = await extractRuntimeSchemaMetadata(this.db, this.dialect, 'public');
            
            const liveTableNames = new Set(Object.keys(liveMetadata));
            const targetTableNames = new Set(Object.keys(targetMetadata));
            
            const diff: SchemaDiff = {
                addedTables: Array.from(targetTableNames).filter(t => !liveTableNames.has(t)),
                removedTables: Array.from(liveTableNames).filter(t => !targetTableNames.has(t)),
                modifiedTables: [],
            };
            
            for (const tableName of liveTableNames) {
                if (targetTableNames.has(tableName)) {
                    const tableDiff = compareTables(liveMetadata[tableName], targetMetadata[tableName]);
                    if (tableDiff) {
                        diff.modifiedTables.push(tableDiff);
                    }
                }
            }
            
            console.log('[XPDatabaseConnectionPlus] Schema diff:', {
                addedTables: diff.addedTables,
                removedTables: diff.removedTables,
                modifiedTables: diff.modifiedTables.map((t: any) => ({
                    tableName: t.tableName,
                    addedColumns: t.addedColumns,
                    removedColumns: t.removedColumns,
                    modifiedColumns: t.modifiedColumns?.map((c: any) => c.columnName),
                })),
            });
        });
        
        return Promise.resolve();
    }
    async detectRuntimeSchema(schemaName: string = 'public'): Promise<Record<string, Table>> {
        const tablenames = await this.getTableNames(schemaName);
        const tables: Record<string, Table> = {};
        for (const tableName of tablenames) {
            tables[tableName] = await this.getRuntimeTable(tableName);
        }
        return tables;
    }

    buildCondition(table: any, condition?: Condition, value?: Record<string, any>): SQL {
        if (!condition) {
            return sql`true`;
        }
        // Check if condition is already a SQL object (from drizzle-orm's eq(), and(), etc.)
        // SQL objects have a getSQL method or _ property
        if (condition && typeof condition === 'object' && ('getSQL' in condition || '_' in condition || 'queryChunks' in condition)) {
            return condition as SQL;
        }
        if (Array.isArray(condition)) {
            if (condition.length === 0) {
                return sql`true`;
            }else if (condition.length === 1){
                return this.buildCondition(table, condition[0], value);
            }else{
                return and(...condition.map((c: Condition) => this.buildCondition(table, c, value))) as SQL;
            }
        }
        if (typeof condition === "string"){
            if (!value){
                throw new Error("value must be specified when using string conditions")
            }
            condition = {[condition]: value[condition]}
        }
        if (isRecord(condition)) {
            const conditions = Object.entries(condition).map(([key, value]) => {
                const column = table[key];
                if (!column) {
                    throw new Error(`Column "${key}" not found in table`);
                }
                if (value === null || value === undefined) {
                    return isNull(column);
                }
                return eq(column, value);
            });
            if (conditions.length === 1) {
                return conditions[0];
            }
            if (conditions.length === 0) {
                return sql`true`;
            }
            return and(...conditions) as SQL;
        }else{
            throw new Error("Unknown condition");
        }
    }



    /**
     * Get all table names in the database
     * Must be implemented by subclasses
     */
    getTableNames(schemaName: string = 'public'){
        return this.dialect.getTableNames(this.db, schemaName);
    }
    getSchemaNames(options?: { excludeBuiltins?: boolean }){
        return this.dialect.getSchemaNames(this.db, options);
    }
    getTableColumns(tableName: string, schemaName: string = 'public'){
        return this.dialect.getTableColumns(this.db, tableName, schemaName);
    }

    getRuntimeTable(tableName: string, schemaName: string = 'public'): Promise<Table> {
        return this.dialect.getRuntimeTable(this.db, tableName, schemaName);
    }

    /**
     * Get schema JSON representation
     * Returns a JSON-serializable representation of all tables in this connection
     * 
     * @returns JSON-serializable schema metadata for all tables
     */
    async getSchemaJson(): Promise<Record<string, any>> {
        await this.schemaPromise;
        const metadata = await getSchemaJsonFromBoundTables(this.schema, this.dialect.dialectName as 'sqlite' | 'pg');
        return metadata;
    }
    getTable<TTable extends Table>(table: TTable): XPDatabaseTablePlusWithColumns<TTable> {
        return new XPDatabaseTablePlus(this, table) as XPDatabaseTablePlusWithColumns<TTable>;
    }

    /**
     * Passthrough DrizzleDatabase methods to this.db
     */
    execute(query: SQL): Promise<QueryResult> {
        return this.db.execute(query);
    }

    // @ts-ignore
    select(columns?: Record<string, any> | any[]): SelectQueryBuilder {
        // @ts-ignore
        return this.db.select(columns);
    }

    insert<T extends DrizzleTable>(table: T | any): InsertQueryBuilder<T> {
        return this.db.insert(table);
    }

    update<T extends DrizzleTable>(table: T | any): UpdateQueryBuilder<T> {
        return this.db.update(table);
    }

    delete<T extends DrizzleTable>(table: T | any): DeleteQueryBuilder<T> {
        return this.db.delete(table);
    }
    selectWhere<T extends DrizzleTable>(table: T | any, condition?: ResolvedCondition, columns?: Record<string, any> | any[]): SelectQueryBuilder {
        const w = this.buildCondition(table, condition);
        return this.db.select(columns).from(table).where(w);
    }
    deleteWhere<T extends DrizzleTable>(table: T | any, condition?: ResolvedCondition): DeleteQueryBuilder<T> {
        const w = this.buildCondition(table, condition);
        return this.db.delete(table).where(w);
    }
    async countWhere<T extends DrizzleTable>(table: T | any, condition?: ResolvedCondition): Promise<number> {
        const w = this.buildCondition(table, condition);
        const r = await this.db.select({ count: count() }).from(table).where(w);
        return r[0].count as number;
    }


    upsertWhere<T extends DrizzleTable>(table: T | any, values: Record<string, any>[], condition: UnresolvedCondition): Promise<any>;
    upsertWhere<T extends DrizzleTable>(table: T | any, value: Record<string, any>, condition: Condition): Promise<any>;
    async upsertWhere<T extends DrizzleTable>(table: T | any, value: Record<string, any> | Record<string, any>[], condition: Condition): Promise<any> {
        if (Array.isArray(value)) {
            let p = Promise.all(value.map((v: Record<string, any>) => (this.upsertWhere(table, v, condition))));
            //@ts-ignore
            p.returning = (columns?: Record<string, any | UpsertActionType> | string | UpsertActionType) => Promise.all(p.then((q) => q.returning(columns).then((r: any)=> r[0])));
            return p;
        }

        const w = this.buildCondition(table, condition, value);


        //@ts-ignore
        return this.select().from(table).where(w).limit(2).then(
            //@ts-ignore
            (existing) => {
                let query: any;
                let action: UpsertActionType;

                if (existing.length === 2){
                    throw new Error("More than one existing record meets the specified condition");
                }else if (!existing.length){
                    query = this.insert(table).values(value);
                    action = 'inserted' as UpsertActionType;
                }else{
                    const hasChanges = Object.keys(value).some(k => value[k] !== existing[0][k]);
                    if (hasChanges){
                        query = this.update(table).set(value).where(w);
                        action = 'updated' as UpsertActionType;
                    }else{
                        query = new Promise((resolve, reject) => resolve(existing));
                        action = 'unchanged' as UpsertActionType;
                    }
                }


                query.returning = (columns?: Record<string, any | UpsertActionType> | string | UpsertActionType) => {
                    if (columns === UpsertAction) {
                        return query.then((_: any) => action) as Promise<UpsertActionType>;
                    }
                    else if (isRecord(columns) && Object.values(columns).some( v => v === UpsertAction)){
                        const nonUpsertColumns = Object.fromEntries(Object.entries(columns).filter(([k, v]) => v !== UpsertAction));
                        const uk = Object.keys(columns).find(k => columns[k] === UpsertAction)!;
                        if (action === 'unchanged'){
                            return query.then((existing: Record<string, any>[]) => existing.map(o => ({
                                    ...Object.fromEntries(nonUpsertColumns.map(([columnName, column]: [string, any]) => [columnName, existing[column.name]])),
                                    [uk]: action
                                })
                            ))
                        }else{
                            return query.returning(nonUpsertColumns).then((results: Record<string, any>[]) => results.map((o: Record<string, any>) => ({...o, [uk]: action})))
                        }
                    }else{
                        return query.returning(columns);
                    }
                }
                return query;
            }
        )
    }



    /**
     * Get row count for a specific table
     * Concrete implementation that works with any adapter
     * Uses Drizzle's sql template tag for dynamic table names
     */
    async getRowCount(tableName: string): Promise<number> {
        try {
            // Use Drizzle's sql template tag for dynamic table names
            const result = await this.db.execute(
                sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}`
            ) as any[];
            
            const rowCount = result[0]?.count;
            if (typeof rowCount === 'number') {
                return rowCount;
            } else if (rowCount !== null && rowCount !== undefined) {
                return parseInt(String(rowCount), 10) || 0;
            }
            return 0;
        } catch (err) {
            // Table might not exist or be accessible
            console.warn(`Could not count rows in table ${tableName}:`, err);
            return 0;
        }
    }

    /**
     * Get metadata for a database (table count, total row count, and row counts per table)
     * Concrete implementation that works with any adapter
     */
    async getMetadata(): Promise<{
        tableCount: number;
        totalRowCount: number;
        tableRowCounts: Record<string, number>;
    }> {
        // Get table names
        const tableNames = await this.getTableNames();

        if (tableNames.length === 0) {
            return { tableCount: 0, totalRowCount: 0, tableRowCounts: {} };
        }

        // Count rows in each table
        let totalRowCount = 0;
        const tableRowCounts: Record<string, number> = {};

        for (const tableName of tableNames) {
            const count = await this.getRowCount(tableName);
            tableRowCounts[tableName] = count;
            totalRowCount += count;
        }

        return {
            tableCount: tableNames.length,
            totalRowCount,
            tableRowCounts,
        };
    }



    deleteDatabase(entry: DbConnectionInfo): Promise<void> {
        return this.db.deleteDatabase(entry);
    }

    /**
     * Check if the database schema needs migration
     * 
     * Compares the current runtime schema in the database with the connected schema
     * to determine if they are identical or if migrations are needed.
     * 
     * @param options - Optional configuration
     * @param options.schemaName - Schema name to check (default: 'public')
     * @returns True if schemas are identical (no migration needed), false if migration is needed
     * 
     * @example
     * ```ts
     * const db = await schema.connect(connInfo);
     * if (!await db.isSchemaUpToDate()) {
     *   await db.createOrMigrate();
     * }
     * ```
     */
    async isSchemaUpToDate(options?: {
        schemaName?: string;
    }): Promise<boolean> {
        const schemaName = options?.schemaName || 'public';

        // Wait for schema to be registered
        await this.schemaPromise;

        if (!this.schema || Object.keys(this.schema).length === 0) {
            const tableNames = await this.getTableNames(schemaName);
            return tableNames.length === 0;
        }

        const targetMetadata = await getSchemaJsonFromBoundTables(this.schema, this.dialect.dialectName as 'sqlite' | 'pg');
        const liveMetadata = await extractRuntimeSchemaMetadata(this.db, this.dialect, schemaName);
        
        const liveTableNames = new Set(Object.keys(liveMetadata));
        const targetTableNames = new Set(Object.keys(targetMetadata));
        
        const diff: SchemaDiff = {
            addedTables: Array.from(targetTableNames).filter(t => !liveTableNames.has(t)),
            removedTables: Array.from(liveTableNames).filter(t => !targetTableNames.has(t)),
            modifiedTables: [],
        };
        
        for (const tableName of liveTableNames) {
            if (targetTableNames.has(tableName)) {
                const tableDiff = compareTables(liveMetadata[tableName], targetMetadata[tableName]);
                if (tableDiff) {
                    diff.modifiedTables.push(tableDiff);
                }
            }
        }

        return diff.addedTables.length === 0 && diff.removedTables.length === 0 && diff.modifiedTables.length === 0;
    }

    /**
     * Create or migrate the database schema
     * 
     * Detects the current runtime schema in the database and compares it with
     * the connected schema. If there are differences, generates and executes
     * the necessary migration SQL to bring the database up to date.
     * 
     * @param options - Optional configuration
     * @param options.schemaName - Schema name to check (default: 'public')
     * @param options.dryRun - If true, only return the migration SQL without executing it
     * @returns Migration result with diff information and SQL
     * 
     * @example
     * ```ts
     * const db = await schema.connect(connInfo);
     * if (!await db.isSchemaUpToDate()) {
     *   await db.createOrMigrate();
     * }
     * ```
     */
    async createOrMigrate(options?: {
        schemaName?: string;
        dryRun?: boolean;
    }): Promise<{
        migrationSQL: string;
        diff: SchemaDiff;
        executed: boolean;
    }> {
        const schemaName = options?.schemaName || 'public';
        const dryRun = options?.dryRun || false;

        // Wait for schema to be registered
        await this.schemaPromise;

        // Check if schema is populated
        if (!this.schema || Object.keys(this.schema).length === 0) {
            throw new Error(
                'Cannot create or migrate: schema is empty. ' +
                'Make sure you connect with a schema that has tables defined.'
            );
        }

        const schemaTableNames = Object.keys(this.schema);
        if (schemaTableNames.length === 0) {
            throw new Error('Schema has no tables to extract metadata from');
        }
        
        const targetMetadata = await getSchemaJsonFromBoundTables(this.schema, this.dialect.dialectName as 'sqlite' | 'pg');
        const liveMetadata = await extractRuntimeSchemaMetadata(this.db, this.dialect, schemaName);

        const liveTableNames = new Set(Object.keys(liveMetadata));
        const targetTableNames = new Set(Object.keys(targetMetadata));
        
        const diff: SchemaDiff = {
            addedTables: Array.from(targetTableNames).filter(t => !liveTableNames.has(t)),
            removedTables: Array.from(liveTableNames).filter(t => !targetTableNames.has(t)),
            modifiedTables: [],
        };
        
        for (const tableName of liveTableNames) {
            if (targetTableNames.has(tableName)) {
                const tableDiff = compareTables(liveMetadata[tableName], targetMetadata[tableName]);
                if (tableDiff) {
                    diff.modifiedTables.push(tableDiff);
                }
            }
        }

        // Log the diff for debugging
        console.log('[XPDatabaseConnectionPlus] Schema diff:', JSON.stringify(diff, null, 2));
        
        // Log detailed information about modified tables
        if (diff.modifiedTables.length > 0) {
            console.log('[XPDatabaseConnectionPlus] Modified tables details:');
            for (const tableDiff of diff.modifiedTables) {
                console.log(`  Table: ${tableDiff.tableName}`);
                if (tableDiff.addedColumns.length > 0) {
                    console.log(`    Added columns: ${tableDiff.addedColumns.join(', ')}`);
                }
                if (tableDiff.removedColumns.length > 0) {
                    console.log(`    Removed columns: ${tableDiff.removedColumns.join(', ')}`);
                }
                if (tableDiff.modifiedColumns.length > 0) {
                    console.log(`    Modified columns:`);
                    for (const modCol of tableDiff.modifiedColumns) {
                        console.log(`      ${modCol.columnName}: ${modCol.changes.join(', ')}`);
                    }
                }
                if (tableDiff.addedForeignKeys.length > 0) {
                    console.log(`    Added foreign keys: ${tableDiff.addedForeignKeys.length}`);
                }
                if (tableDiff.removedForeignKeys.length > 0) {
                    console.log(`    Removed foreign keys: ${tableDiff.removedForeignKeys.length}`);
                }
                if (tableDiff.addedUniqueConstraints.length > 0) {
                    console.log(`    Added unique constraints: ${tableDiff.addedUniqueConstraints.length}`);
                }
                if (tableDiff.removedUniqueConstraints.length > 0) {
                    console.log(`    Removed unique constraints: ${tableDiff.removedUniqueConstraints.length}`);
                }
                if (tableDiff.addedIndexes.length > 0) {
                    console.log(`    Added indexes: ${tableDiff.addedIndexes.length}`);
                }
                if (tableDiff.removedIndexes.length > 0) {
                    console.log(`    Removed indexes: ${tableDiff.removedIndexes.length}`);
                }
            }
        }

        // Check if there are any differences
        const hasChanges = 
            diff.addedTables.length > 0 ||
            diff.removedTables.length > 0 ||
            diff.modifiedTables.length > 0;

        if (!hasChanges) {
            // No changes needed - database is already up to date
            console.log('[XPDatabaseConnectionPlus] No schema changes detected');
            return {
                migrationSQL: '',
                diff,
                executed: false,
            };
        }

        console.log(`[XPDatabaseConnectionPlus] Schema changes detected: ${diff.addedTables.length} added tables, ${diff.removedTables.length} removed tables, ${diff.modifiedTables.length} modified tables`);

        // Create snapshots for migration generation
        const targetSnapshot: SchemaSnapshot = {
            version: 1,
            timestamp: Date.now(),
            migrationName: 'createOrMigrate',
            tables: targetMetadata,
            schemaHash: '',
        };

        const liveSnapshot: SchemaSnapshot = {
            version: 1,
            timestamp: Date.now(),
            migrationName: 'live',
            tables: liveMetadata,
            schemaHash: '',
        };

        // Generate migration SQL
        console.log('[XPDatabaseConnectionPlus] Generating migration SQL from diff...');
        const migrationSQL = generateMigrationFromSnapshotDiff(
            diff,
            targetSnapshot,
            this.dialect.dialectName as 'sqlite' | 'pg',
            liveSnapshot
        );

        // Log migration SQL
        if (migrationSQL.trim()) {
            console.log('[createOrMigrate] Migration SQL:');
            console.log(migrationSQL);
            console.log('[createOrMigrate] End of migration SQL');
        } else {
            console.log('[createOrMigrate] No migration SQL generated (schema is up to date)');
        }

        // Execute migration if not dry run
        if (!dryRun && migrationSQL.trim()) {
            const statements = migrationSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.match(/^\s*--/));

            console.log(`[createOrMigrate] Executing ${statements.length} SQL statement(s)...`);
            for (const statement of statements) {
                console.log(`[createOrMigrate] Executing: ${statement.substring(0, 100)}${statement.length > 100 ? '...' : ''}`);
                await this.execute(sql.raw(statement));
            }
            console.log('[createOrMigrate] Migration execution completed');
        }

        return {
            migrationSQL,
            diff,
            executed: !dryRun && hasChanges,
        };
    }

    /**
     * Delete entities that are not in the provided list
     * Useful for syncing arrays of children
     * 
     * @param table - Table to delete from
     * @param parentIdColumn - Column reference for the parent ID
     * @param parentId - Parent ID to filter by
     * @param keepIds - Array of child IDs to keep (all others will be deleted)
     */
    async deleteMissingChildren<T extends DrizzleTable>(
        table: T | any,
        parentIdColumn: any,
        parentId: string,
        keepIds: string[]
    ): Promise<void> {
        if (keepIds.length === 0) {
            // Delete all children if none are provided
            await this.delete(table).where(eq(parentIdColumn, parentId));
            return;
        }
        
        // Delete children not in the keep list
        await this.delete(table)
            .where(
                //@ts-ignore
                and(
                    eq(parentIdColumn, parentId),
                    notInArray(table.id, keepIds)
                )
            );
    }

}




