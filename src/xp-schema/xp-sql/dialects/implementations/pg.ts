import {
    pgTable, pgMaterializedView, pgView,
    text as drizzleText, varchar as drizzleVarchar,
    integer as drizzleInteger, real as drizzleReal, doublePrecision as drizzleDoublePrecision, 
    numeric as drizzleNumeric, bigint as drizzleBigint, smallint as drizzleSmallint, serial,

    json as drizzleJson, jsonb as drizzleJsonb,
    boolean as drizzleBool,
    timestamp as drizzleTimestamp, time as drizzleTime, date as drizzleDate,

    unique, index, check
} from 'drizzle-orm/pg-core';
import {
    DialectBuilders,
    BaseDialectColumnBuilders,
    SQLDialect,
    TextOptions,
    IntegerOptions,
    RealOptions,
    TimestampOptions,
    DateOptions,
    TimeOptions,
    BlobOptions,
    BigintOptions,
    SmallintOptions,
    BooleanOptions,
    JsonOptions,
    VarcharConfig,
    NumericConfig, ColumnInfo, DrizzleColumnInfo,
    PrimaryKeyInfo,
    ForeignKeyInfo,
    UniqueConstraintInfo,
    IndexInfo,
} from "../types";
import {DrizzleDatabaseConnectionDriver} from "../../drivers/types";
import {sql} from "drizzle-orm";
import {customType} from "drizzle-orm/sqlite-core";
import type {Table, ColumnBuilder} from "drizzle-orm";
import { extendDialectWithComposedBuilders } from './composed';

// Type alias for extended column builder (used for type compatibility)
type ExtendedColumnBuilder<TColData = any, TInferred = any, TIsPrimaryKey extends boolean = false> = ColumnBuilder;
type ExtendedTable<TTable = any> = Table;

// Option 1: use customType with explicit "bytea"
export const bytea = customType<{
    data: Uint8Array;
    driverData: Uint8Array;
}>({
    dataType() {
        return "bytea"; // what shows up in migrations / SQL
    },
});


// Wrap Drizzle builders to match our typed interface and return ExtendedColumnBuilder
const pgText = (name: string, opts?: TextOptions) => drizzleText(name);
const pgVarchar = (name: string, opts?: VarcharConfig) => drizzleVarchar(name, opts as any);
const pgInteger = (name: string, opts?: IntegerOptions) => drizzleInteger(name);
const pgReal = (name: string, opts?: RealOptions)=> drizzleReal(name);
const pgDoublePrecision = (name: string, opts?: RealOptions) => drizzleDoublePrecision(name);
const pgBigint = (name: string, opts?: BigintOptions) => drizzleBigint(name, opts as any);
const pgSmallint = (name: string, opts?: SmallintOptions) => drizzleSmallint(name);
const pgNumeric = (name: string, opts?: NumericConfig) => drizzleNumeric(name, opts);
const pgBool = (name: string, opts?: BooleanOptions) => drizzleBool(name);
const pgTimestamp = (name: string, opts?: TimestampOptions) => drizzleTimestamp(name, opts as any);
const pgTime = (name: string, opts?: TimeOptions) => drizzleTime(name, opts);
const pgDate = (name: string, opts?: DateOptions) => drizzleDate(name, opts);
const pgJson = (name: string, opts?: JsonOptions) => drizzleJson(name);
const pgJsonb = (name: string, opts?: JsonOptions) => drizzleJsonb(name);
const pgBlob = (name: string, opts?: BlobOptions) => bytea(name);



const pgColumnBuildersBase: BaseDialectColumnBuilders = {
    text: pgText,
    varchar: pgVarchar,
    json: pgJson,
    jsonb: pgJsonb,
    integer: pgInteger,
    real: pgReal,
    doublePrecision: pgDoublePrecision,
    bigint: pgBigint,
    smallint: pgSmallint,
    pkserial: (name: string) => serial(name).primaryKey(),
    blob: pgBlob,
    numeric: pgNumeric,
    bool: pgBool,
    boolean: pgBool,
    timestamp: pgTimestamp,
    time: pgTime,
    date: pgDate,
};

// Extend with composed builders (uuid, uuidDefault, uuidPK)
const pgColumnBuilders = extendDialectWithComposedBuilders(pgColumnBuildersBase);
// Wrap pgTable to add $primaryKey property while preserving the original type
function pgTableExtended<
  TName extends string,
  TColumns extends Record<string, any>,
  TExtraConfigBuilder extends ((self: any) => any[]) | undefined = undefined
>(
    name: TName, 
    columns: TColumns, 
    extraConfig?: TExtraConfigBuilder
) {
    const table = pgTable(name, columns, extraConfig);
    
    // Extract the primary key column type from the INPUT columns (ExtendedColumnBuilder)
    // We need to check the input columns for __isPrimaryKey, then map to the output table columns
    type TableType = typeof table;
    
    // Helper to extract __isPrimaryKey from input ExtendedColumnBuilder
    type ExtractIsPrimaryKey<C> = 
        C extends ExtendedColumnBuilder<any, any, infer TIsPK> ? TIsPK : false;
    
    // Map input column keys to their primary key state
    type InputColumnPKMap = {
        [K in keyof TColumns]: ExtractIsPrimaryKey<TColumns[K]>;
    };
    
    // Find which input column is the primary key
    type FindPrimaryKeyInputKey<TMap> = {
        [K in keyof TMap]: TMap[K] extends true ? K : never;
    }[keyof TMap];
    
    type PrimaryKeyInputKey = FindPrimaryKeyInputKey<InputColumnPKMap>;
    
    // Map to the output table column type
    // The output table has columns as direct properties (table.name, table.id, etc.)
    type PrimaryKeyColumnType = PrimaryKeyInputKey extends keyof TableType
        ? TableType[PrimaryKeyInputKey]
        : never;
    
    // Extend output table columns with __isPrimaryKey flag from input columns
    // This allows the columns to be detected as primary keys at the type level
    // We check the output columns' primary property (set by Drizzle) to determine primary keys
    const tableAny = table as any;
    for (const key in tableAny) {
        if (key === 'columns' || key === '_' || key === 'enableRLS' || key.startsWith('$')) continue;
        const outputCol = tableAny[key];
        // Check if this column is a primary key (Drizzle sets col.primary = true)
        if (outputCol && typeof outputCol === 'object' && outputCol.primary === true) {
            // Add __isPrimaryKey flag to the output column for type-level detection
            Object.defineProperty(outputCol, '__isPrimaryKey', {
                value: true,
                enumerable: false,
                configurable: true,
            });
        } else if (outputCol && typeof outputCol === 'object') {
            // Mark non-primary columns explicitly
            Object.defineProperty(outputCol, '__isPrimaryKey', {
                value: false,
                enumerable: false,
                configurable: true,
            });
        }
    }
    
    // Find the primary key column from the table's columns
    // Drizzle exposes columns directly on the table object (e.g., table.id, table.name)
    
    // Add $primaryKey getter that returns the actual primary key column
    // Search at runtime to ensure we get the current value
    Object.defineProperty(table, '$primaryKey', {
        get(): PrimaryKeyColumnType | undefined {
            const tableAny = this as any;
            
            // Check columns exposed directly on the table (table.id, table.name, etc.)
            // Drizzle exposes columns as properties on the table object
            for (const key in tableAny) {
                // Skip known non-column properties
                if (key === 'columns' || key === '_' || key === 'enableRLS' || key.startsWith('$')) continue;
                
                const col = tableAny[key];
                // Check if it's a column object with primary key
                // Drizzle sets col.primary = true for primary key columns
                if (col && typeof col === 'object' && (col as any).primary === true) {
                    return col as PrimaryKeyColumnType;
                }
            }
            
            // Fallback: also check table.columns if it exists
            if (tableAny.columns && typeof tableAny.columns === 'object') {
                for (const [key, column] of Object.entries(tableAny.columns)) {
                    const col = column as any;
                    if (col && typeof col === 'object' && col.primary === true) {
                        return col as PrimaryKeyColumnType;
                    }
                }
            }
            
            return undefined as PrimaryKeyColumnType | undefined;
        },
        enumerable: false,
        configurable: true,
    });
    
    // Use intersection type to add $primaryKey while preserving the original type
    // Also extend column types with __isPrimaryKey for type-level detection
    type ExtendedTableType = TableType & {
        /** Get the primary key column from this table (detected using __isPrimaryKey flag) */
        readonly $primaryKey: PrimaryKeyColumnType extends never ? undefined : PrimaryKeyColumnType;
    } & {
        // Extend each column with __isPrimaryKey flag if it was a primary key in input
        [K in keyof TableType]: K extends PrimaryKeyInputKey
            ? TableType[K] & { readonly __isPrimaryKey: true }
            : TableType[K] & { readonly __isPrimaryKey: false };
    };
    
    return table as ExtendedTableType;
}

const pgBuilders: DialectBuilders = {
    //@ts-ignore
    table: pgTableExtended,
    ...pgColumnBuilders,
    unique, index,
    // @ts-ignore
    check,
}


function pgTypeToDrizzleColumn(col: ColumnInfo): any {
    // VERY rough mapping – you’ll want to refine this
    const { name, dataType, isNullable } = col;

    const base = (() => {
        switch (dataType) {
            case 'integer':
            case 'int4':
                return integer(name);
            case 'bigint':
            case 'int8':
                return bigint(name);
            case 'boolean':
                return boolean(name);
            case 'numeric':
            case 'decimal':
                return numeric(name);
            case 'timestamp without time zone':
            case 'timestamp with time zone':
                return timestamp(name);
            case 'text':
            case 'character varying':
            default:
                return text(name);
        }
    })();

    return isNullable ? base : base.notNull();
}
async function getTableNames(db: DrizzleDatabaseConnectionDriver, schemaName: string = 'public'): Promise<string[]>   {
    const result = await db.execute(sql`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = ${schemaName} 
                    AND table_type = 'BASE TABLE'
                    ORDER BY table_name
              `);
    // All drivers now return QueryResult format with rows property
    return result.rows.map((row: any) => row.table_name);
}
async function getSchemaNames(
    db: DrizzleDatabaseConnectionDriver,
    options?: { excludeBuiltins?: boolean }
): Promise<string[]> {
    const staticBuiltin = [
        'pg_catalog',
        'information_schema',
        'pg_toast'
    ];

    const isBuiltin = (name: string) => {
        if (staticBuiltin.includes(name)) return true;
        if (name.startsWith('pg_temp_')) return true;
        if (name.startsWith('pg_toast_temp_')) return true;
        return false;
    };

    const result = await db.execute(sql`
    SELECT schema_name
    FROM information_schema.schemata
    ORDER BY schema_name
  `);

    return result.rows
        .map((row: any) => row.schema_name)
        .filter(name => !(options?.excludeBuiltins && isBuiltin(name)));
}
async function getTableColumns(db: DrizzleDatabaseConnectionDriver, tableName: string, schemaName: string = 'public'): Promise<DrizzleColumnInfo[]>  {
    const result = await db.execute(sql`
        SELECT 
          column_name as name,
          data_type as "dataType",
          is_nullable = 'YES' as "isNullable"
        FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        ORDER BY ordinal_position
      `);

    const info = result.rows.map((row: any) => ({
        name: row.name,
        dataType: row.dataType || row.data_type || 'unknown',
        isNullable: row.isNullable !== undefined ? row.isNullable : row.is_nullable === 'YES',
    }));
    return info.map((row: ColumnInfo) => ({
        ...row,
        drizzleColumn: pgTypeToDrizzleColumn(row)
    }))
}
async function getTablePrimaryKeys(
    db: DrizzleDatabaseConnectionDriver,
    tableName: string,
    schemaName: string = 'public'
): Promise<PrimaryKeyInfo[]> {
    const result = await db.execute(sql`
        SELECT
            tc.constraint_name as "constraintName",
            kcu.column_name as "columnName",
            kcu.ordinal_position as "ordinalPosition"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = ${schemaName}
            AND tc.table_name = ${tableName}
        ORDER BY kcu.ordinal_position
    `);

    if (!result || !result.rows || result.rows.length === 0) {
        return [];
    }

    // Group by constraint name (though typically there's only one PK per table)
    const pkMap = new Map<string, { name?: string; columns: string[] }>();
    for (const row of result.rows as any[]) {
        const constraintName = row.constraintName || row.constraint_name;
        const columnName = row.columnName || row.column_name;
        
        if (!pkMap.has(constraintName)) {
            pkMap.set(constraintName, {
                name: constraintName,
                columns: [],
            });
        }
        pkMap.get(constraintName)!.columns.push(columnName);
    }

    return Array.from(pkMap.values()).map(pk => ({
        name: pk.name,
        columns: pk.columns,
    }));
}

async function getTableForeignKeys(
    db: DrizzleDatabaseConnectionDriver,
    tableName: string,
    schemaName: string = 'public'
): Promise<ForeignKeyInfo[]> {
    const result = await db.execute(sql`
        SELECT
            tc.constraint_name as "constraintName",
            kcu.column_name as "columnName",
            kcu.ordinal_position as "ordinalPosition",
            ccu.table_schema as "referencedTableSchema",
            ccu.table_name as "referencedTableName",
            ccu.column_name as "referencedColumnName",
            rc.update_rule as "updateRule",
            rc.delete_rule as "deleteRule"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
        JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        LEFT JOIN information_schema.referential_constraints rc
            ON rc.constraint_name = tc.constraint_name
            AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = ${schemaName}
            AND tc.table_name = ${tableName}
        ORDER BY tc.constraint_name, kcu.ordinal_position
    `);

    if (!result || !result.rows || result.rows.length === 0) {
        return [];
    }

    // Group by constraint name
    const fkMap = new Map<string, {
        name?: string;
        columns: string[];
        referencedTable: string;
        referencedColumns: string[];
        onUpdate?: string;
        onDelete?: string;
    }>();

    for (const row of result.rows as any[]) {
        const constraintName = row.constraintName || row.constraint_name;
        const columnName = row.columnName || row.column_name;
        const referencedTable = row.referencedTableName || row.referenced_table_name;
        const referencedColumn = row.referencedColumnName || row.referenced_column_name;
        const updateRule = row.updateRule || row.update_rule;
        const deleteRule = row.deleteRule || row.delete_rule;

        if (!fkMap.has(constraintName)) {
            fkMap.set(constraintName, {
                name: constraintName,
                columns: [],
                referencedTable,
                referencedColumns: [],
                onUpdate: updateRule,
                onDelete: deleteRule,
            });
        }
        const fk = fkMap.get(constraintName)!;
        if (!fk.columns.includes(columnName)) {
            fk.columns.push(columnName);
        }
        if (!fk.referencedColumns.includes(referencedColumn)) {
            fk.referencedColumns.push(referencedColumn);
        }
    }

    return Array.from(fkMap.values()).map(fk => ({
        name: fk.name,
        columns: fk.columns,
        referencedTable: fk.referencedTable,
        referencedColumns: fk.referencedColumns,
        onUpdate: fk.onUpdate as any,
        onDelete: fk.onDelete as any,
    }));
}

async function getTableUniqueConstraints(
    db: DrizzleDatabaseConnectionDriver,
    tableName: string,
    schemaName: string = 'public'
): Promise<UniqueConstraintInfo[]> {
    const result = await db.execute(sql`
        SELECT
            tc.constraint_name as "constraintName",
            kcu.column_name as "columnName",
            kcu.ordinal_position as "ordinalPosition"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_schema = ${schemaName}
            AND tc.table_name = ${tableName}
        ORDER BY tc.constraint_name, kcu.ordinal_position
    `);

    if (!result || !result.rows || result.rows.length === 0) {
        return [];
    }

    // Group by constraint name
    const uniqueMap = new Map<string, { name?: string; columns: string[] }>();
    for (const row of result.rows as any[]) {
        const constraintName = row.constraintName || row.constraint_name;
        const columnName = row.columnName || row.column_name;

        if (!uniqueMap.has(constraintName)) {
            uniqueMap.set(constraintName, {
                name: constraintName,
                columns: [],
            });
        }
        uniqueMap.get(constraintName)!.columns.push(columnName);
    }

    return Array.from(uniqueMap.values()).map(uc => ({
        name: uc.name,
        columns: uc.columns,
    }));
}

async function getTableIndexes(
    db: DrizzleDatabaseConnectionDriver,
    tableName: string,
    schemaName: string = 'public'
): Promise<IndexInfo[]> {
    const result = await db.execute(sql`
        SELECT
            i.indexname as "indexName",
            a.attname as "columnName",
            i.indexdef as "indexDef",
            ix.indisunique as "isUnique"
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.tablename
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
        JOIN pg_index ix ON ix.indexrelid = (
            SELECT oid FROM pg_class WHERE relname = i.indexname
        )
        JOIN pg_attribute a ON a.attrelid = c.oid
        JOIN pg_index ind ON ind.indexrelid = (
            SELECT oid FROM pg_class WHERE relname = i.indexname
        ) AND a.attnum = ANY(ind.indkey)
        WHERE i.schemaname = ${schemaName}
            AND i.tablename = ${tableName}
            AND NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                WHERE tc.constraint_name = i.indexname
                    AND tc.table_schema = i.schemaname
            )
        ORDER BY i.indexname, array_position(ind.indkey, a.attnum)
    `);

    if (!result || !result.rows || result.rows.length === 0) {
        return [];
    }

    // Group by index name
    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>();
    for (const row of result.rows as any[]) {
        const indexName = row.indexName || row.indexname;
        const columnName = row.columnName || row.attname;
        const isUnique = row.isUnique || row.indisunique;

        if (!indexMap.has(indexName)) {
            indexMap.set(indexName, {
                name: indexName,
                columns: [],
                unique: !!isUnique,
            });
        }
        const idx = indexMap.get(indexName)!;
        if (!idx.columns.includes(columnName)) {
            idx.columns.push(columnName);
        }
    }

    return Array.from(indexMap.values()).map(idx => ({
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
    }));
}

async function getRuntimeTable(
    db: DrizzleDatabaseConnectionDriver,
    tableName: string,
    schemaName: string = "public",
){
    const columns = await getTableColumns(db, tableName, schemaName);

    const colsShape: Record<string, any> = {};
    for (const col of columns) {
        colsShape[col.name] = col.drizzleColumn;
    }

    // This gives you an AnyPgTable you can pass to db.select(), etc.
    return table(tableName, colsShape);
}

const dialectName = "pg";
const pgDialect: SQLDialect = {
    dialectName,

    ...pgBuilders,

    getTableNames,

    getSchemaNames,
    getTableColumns,
    getRuntimeTable,
    getTablePrimaryKeys,
    getTableForeignKeys,
    getTableUniqueConstraints,
    getTableIndexes,


};


export default pgDialect;

// Export all column builders
export const text = pgText;
export const varchar = pgVarchar;
export const uuid = pgColumnBuilders.uuid;
export const uuidDefault = pgColumnBuilders.uuidDefault;
export const uuidPK = pgColumnBuilders.uuidPK;
export const json = pgJson;
export const jsonb = pgJsonb;
export const integer = pgInteger;
export const real = pgReal;
export const doublePrecision = pgDoublePrecision;
export const bigint = pgBigint;
export const smallint = pgSmallint;
export const pkserial = (name: string) => serial(name).primaryKey();
export const blob = pgBlob;
export const numeric = pgNumeric;
export const bool = pgBool;
export const boolean = pgBool;
export const timestamp = pgTimestamp;
export const time = pgTime;
export const date = pgDate;

// Export table builders
export const table = pgTableExtended;

// Export constraint builders
export { unique, index, check };
