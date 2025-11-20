import {errors} from "@ts-morph/common";
import NotImplementedError = errors.NotImplementedError;
import {DrizzleDatabaseConnectionDriver} from "../drivers/types";
import type {ColumnBuilder, Table, Column} from "drizzle-orm";
import {UColumn} from "./implementations/unbound";


export interface ColumnLevelEntity {}
export interface Index extends ColumnLevelEntity {}
export interface Constraint extends ColumnLevelEntity {}

/**
 * ColumnBuilder with .references() method added
 */
export type ColumnBuilderWithReferences<TType = any> = UColumn<TType> & {
    /**
     * Add a foreign key reference to another column
     * @param refFn Function that returns the column to reference
     */
    references(refFn: () => Column | UColumn): ColumnBuilderWithReferences;
};

/**
 * Timestamp ColumnBuilder with .defaultNow() method added
 */
export type TimestampColumnBuilderWithDefaultNow = ColumnBuilderWithReferences<Date> & {
    /**
     * Set the default value to the current timestamp
     */
    defaultNow(): TimestampColumnBuilderWithDefaultNow;
};

export type Columns = Record<string, ColumnBuilder>;



export type ColumnOpts<T extends Record<string, any> = Record<string, any>> = T | undefined;
export type IndexOpts<T extends Record<string, any> = Record<string, any>> = T | undefined;
export type ConstraintOpts<T extends Record<string, any> = Record<string, any>> = T | undefined;

export const notImplemented = (msg: string = "Not Implemented") => {
    return () => {
        throw new NotImplementedError(msg)
    }
}
export const notImplementedForDialect = (feature: string = "Feature", dialect: string) => {
    return notImplemented(`${feature} has not been implemented for dialect "${dialect}"`)
}
export type TableBuilderFn<T extends Columns = Columns> = (name: string, columns: T, constraintBuilder?: (table: Table) => (Constraint | Index)[]) => Table;
export type ColumnBuilderFn<T extends ColumnOpts = ColumnOpts, TTypeBase = any> = <TType extends TTypeBase = TTypeBase>(name: string, opts?: T) => ColumnBuilderWithReferences<TType>;
export type TimestampColumnBuilderFn<T extends ColumnOpts = ColumnOpts> = (name: string, opts?: T) => TimestampColumnBuilderWithDefaultNow;
export type IndexBuilderFn<T extends IndexOpts = IndexOpts> = (name: string, opts: T) => Index;
export type UniqueConstraintBuilderFn<T extends ConstraintOpts = ConstraintOpts> = (name: string, opts: T) => Constraint;
export type CheckConstraintBuilderFn<T extends ConstraintOpts = ConstraintOpts> = (name: string, opts: T) => Constraint;





// ============================================================================
// Column Option Types
// ============================================================================

/**
 * Common column options used across multiple column types
 */
export interface BaseColumnOptions {
    /** Mode for type conversion (e.g., 'json', 'boolean', 'timestamp', 'number', 'string') */
    mode?: 'buffer' | 'bigint' | 'date' | 'time' | 'json' | 'boolean' | 'timestamp' | 'number' | 'string';
}

/**
 * Text column options
 */
export interface TextOptions extends BaseColumnOptions {
}

/**
 * Varchar column options
 */
export interface VarcharConfig<TEnum extends readonly string[] | string[] | undefined = readonly string[] | string[] | undefined, TLength extends number | undefined = number | undefined> {
    enum?: TEnum;
    length?: TLength;
}
export interface UUIDConfig<TLength extends number | undefined = number | undefined> {
    length?: TLength;
}



/**
 * Integer column options
 */
export interface IntegerOptions extends BaseColumnOptions {
    mode: 'boolean' | 'timestamp' | 'number';
}

/**
 * Real (floating point) column options
 */
export interface RealOptions extends BaseColumnOptions {
}

/**
 * Timestamp column options
 */
export interface TimestampOptions extends BaseColumnOptions {
    mode: 'timestamp' | 'string' | 'date';
    withTimezone?: boolean;
}

/**
 * Date column options
 */
export interface DateOptions extends BaseColumnOptions {
    mode: 'date' | 'string';
}

/**
 * Time column options
 */
export interface TimeOptions extends BaseColumnOptions {
    mode?: 'time' | 'string';
    withTimezone?: boolean;
}

/**
 * Blob column options
 */
export interface BlobOptions extends BaseColumnOptions {
    mode: 'buffer' | 'json' | 'bigint';
}

/**
 * Numeric column options
 */
export type NumericConfig<T extends 'string' | 'number' | 'bigint' = 'string' | 'number' | 'bigint'> = {
    precision: number;
    scale?: number;
    mode?: T;
} | {
    precision?: number;
    scale: number;
    mode?: T;
} | {
    precision?: number;
    scale?: number;
    mode: T;
};

/**
 * Bigint column options
 */
export interface BigintOptions extends BaseColumnOptions {
    mode: 'bigint' | 'string' | 'number';
}

/**
 * Smallint column options
 */
export interface SmallintOptions extends BaseColumnOptions {
    mode: 'boolean' | 'number';
}

/**
 * Boolean column options
 */
export interface BooleanOptions extends BaseColumnOptions {
    mode?: 'boolean' | 'number' | 'string';
}

/**
 * JSON/JSONB column options
 */
export interface JsonOptions extends BaseColumnOptions {
}





export interface BaseDialectColumnBuilders {
    text: ColumnBuilderFn<TextOptions, string>;
    varchar: ColumnBuilderFn<VarcharConfig, string>;
    json: ColumnBuilderFn<JsonOptions, any>;
    jsonb: ColumnBuilderFn<JsonOptions, any>;
    integer: ColumnBuilderFn<IntegerOptions, any>;
    bigint: ColumnBuilderFn<BigintOptions, number>;
    smallint: ColumnBuilderFn<SmallintOptions, number>;
    pkserial: ColumnBuilderFn<{}, string>;
    real: ColumnBuilderFn<RealOptions, number>;
    doublePrecision: ColumnBuilderFn<RealOptions, number>;
    numeric: ColumnBuilderFn<NumericConfig, number>;
    bool: ColumnBuilderFn<BooleanOptions, boolean>;
    boolean: ColumnBuilderFn<BooleanOptions, boolean>;
    date: ColumnBuilderFn<DateOptions, Date>;
    time: ColumnBuilderFn<TimeOptions, Date>;
    timestamp: TimestampColumnBuilderFn<TimestampOptions>;
    blob: ColumnBuilderFn<BlobOptions, Uint8Array>;
}
export interface ComposedColumnBuilders {
    // Composed builders (automatically added via extendDialectWithComposedBuilders)
    uuid: (name: string, options?: { length?: number }) => UColumn<string | null, {}>;
    uuidDefault: (name: string, options?: { length?: number }) => UColumn<string, { hasDefault: true}>;
    uuidPK: (name: string, options?: { length?: number }) => UColumn<string, { hasDefault: true, isPrimaryKey: true}>;
}
export interface DialectColumnBuilders extends BaseDialectColumnBuilders, ComposedColumnBuilders {}
export type ColumnType = keyof BaseDialectColumnBuilders;

export interface DialectConstraintBuilders {
    unique: UniqueConstraintBuilderFn;
    check: CheckConstraintBuilderFn;
}
export type ConstraintType = keyof DialectConstraintBuilders;

export interface DialectTableLevelEntityBuilders extends BaseDialectColumnBuilders, DialectConstraintBuilders {
    table: TableBuilderFn;
    index: IndexBuilderFn;
}
export type TableLevelEntityType = keyof DialectTableLevelEntityBuilders;


export interface DialectBuilders extends BaseDialectColumnBuilders, DialectConstraintBuilders, DialectTableLevelEntityBuilders {

}

export type BuilderType = keyof DialectBuilders;

export interface ColumnInfo{
    name: string;
    dataType: string;
    isNullable: boolean;
}
export interface DrizzleColumnInfo extends ColumnInfo{
    drizzleColumn: any;
}

/**
 * Primary key constraint information
 */
export interface PrimaryKeyInfo {
    name?: string; // Constraint name (may be undefined for unnamed constraints)
    columns: string[]; // Column names that form the primary key
}

/**
 * Foreign key action type - accepts both lowercase and uppercase
 */
export type ForeignKeyAction = 
  | 'CASCADE' | 'cascade'
  | 'RESTRICT' | 'restrict'
  | 'SET NULL' | 'set null'
  | 'SET DEFAULT' | 'set default'
  | 'NO ACTION' | 'no action';

/**
 * Foreign key constraint information
 */
export interface ForeignKeyInfo {
    name?: string; // Constraint name (may be undefined for unnamed constraints)
    columns: string[]; // Column names in this table
    referencedTable: string; // Referenced table name
    referencedColumns: string[]; // Referenced column names
    onUpdate?: ForeignKeyAction;
    onDelete?: ForeignKeyAction;
}

/**
 * Unique constraint information
 */
export interface UniqueConstraintInfo {
    name?: string; // Constraint name (may be undefined for unnamed constraints)
    columns: string[]; // Column names that form the unique constraint
}

/**
 * Index information
 */
export interface IndexInfo {
    name: string; // Index name
    columns: string[]; // Column names in the index
    unique: boolean; // Whether the index is unique
    partial?: boolean; // Whether the index is partial (has a WHERE clause)
}

export interface SQLDialect extends DialectBuilders{
    dialectName: string;


    getTableNames: (db: DrizzleDatabaseConnectionDriver, schemaName?: string) => Promise<string[]>;
    getSchemaNames: (db: DrizzleDatabaseConnectionDriver, options?: { excludeBuiltins?: boolean }) => Promise<string[]>;
    getTableColumns: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ) => Promise<DrizzleColumnInfo[]>;
    getRuntimeTable: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string,
    ) => Promise<Table>;
    
    /**
     * Get primary key constraints for a table
     */
    getTablePrimaryKeys: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ) => Promise<PrimaryKeyInfo[]>;
    
    /**
     * Get foreign key constraints for a table
     */
    getTableForeignKeys: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ) => Promise<ForeignKeyInfo[]>;
    
    /**
     * Get unique constraints for a table (excluding primary keys)
     */
    getTableUniqueConstraints: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ) => Promise<UniqueConstraintInfo[]>;
    
    /**
     * Get indexes for a table (excluding unique constraints and primary keys)
     */
    getTableIndexes: (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ) => Promise<IndexInfo[]>;
}

