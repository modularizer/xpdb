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



export async function connect(connInfo: DbConnectionInfo, schema?: Record<string, Table> | string): Promise<XPDatabaseConnectionPlus> {
    const driver = await connectToDriver(connInfo);
    const dialectName = driver.dialectName;
    const dialect = await getDialectFromName(dialectName);
    return new XPDatabaseConnectionPlus(driver, dialect, schema);
}

export class XPDatabaseConnectionPlus extends XPDatabaseConnection {
    tables: Record<string, XPDatabaseTablePlus> = {};
    schema: Record<string, Table> = {};
    schemaPromise: Promise<void>;


    constructor(
        db: DrizzleDatabaseConnectionDriver,
        dialect: SQLDialect,
        schema?: Record<string, Table> | string
    ) {
        super(db, dialect);
        this.schemaPromise = this.registerSchema(schema);
    }

    registerSchema(schema?: Record<string, Table> | string): Promise<void> {
        if (!schema) {
            return this.detectRuntimeSchema().then((detectedSchema) => this.registerSchema(detectedSchema))
        }else if (typeof schema === "string"){
            return this.detectRuntimeSchema(schema).then((detectedSchema) => this.registerSchema(detectedSchema))
        }
        this.schema = schema;
        for (let [tableName, table] of Object.entries(schema)) {
            this.tables[tableName] = this.getTable(table);
            //@ts-ignore
            this[tableName] = this.getTable(table);
        }
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
        if (Array.isArray(condition)) {
            if (condition.length === 0) {
                return sql`true`;
            }else if (condition.length === 1){
                return this.buildCondition(table, condition, value);
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
        // Wait for schema to be registered
        await this.schemaPromise;
        
        const dialectName = this.dialect.name === 'postgresql' ? 'pg' : 'sqlite';
        return getSchemaJsonFromBoundTables(this.schema, dialectName);
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
    updateWhere<T extends DrizzleTable>(table: T | any, condition: ResolvedCondition): UpdateQueryBuilder<T> {
        const w = this.buildCondition(table, condition);
        return this.db.update<T>(table).where(w);
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




