/**
 * Unbound Dialect Implementation
 * 
 * Implements SQLDialect interface but returns unbound columns and tables
 * that can be bound to any dialect when used with a database.
 */

import type {ColumnBuilder, Table, SQL, Column} from 'drizzle-orm';
import {sql} from 'drizzle-orm';
import {
    DialectBuilders,
    BaseDialectColumnBuilders,
    DialectColumnBuilders,
    SQLDialect,
    NumericConfig,
    VarcharConfig,
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
    notImplementedForDialect, DrizzleColumnInfo,
    PrimaryKeyInfo,
    ForeignKeyInfo,
    ForeignKeyAction,
    UniqueConstraintInfo,
    IndexInfo,
} from "../types";
import {DrizzleDatabaseConnectionDriver} from "../../drivers/types";
import {errors} from "@ts-morph/common";
import NotImplementedError = errors.NotImplementedError;
import {extendDialectWithComposedBuilders} from "./composed";

// ============================================================================
// Unbound Column
// ============================================================================

/**
 * Unbound column definition
 * Stores the column type and options, but not yet bound to a dialect
 */
export interface ColData {
  readonly __unbound: true;
  readonly type: string;
  readonly name: string;
  readonly options?: any;
  readonly modifiers: Array<{ method: string; args: any[] }>;
  readonly nullable: boolean; // true if column is nullable (default), false if .notNull() was called
  readonly typeOverride?: any; // Type override from .$type<T>()
}

/**
 * Helper type to check if a type includes null
 */
type IncludesNull<T> = null extends T ? true : false;

/**
 * Helper type to extract the base type (without null)
 */
type BaseType<T> = null extends T ? Exclude<T, null> : T;

/**
 * Helper type to compute the insert type for a single column
 * - Columns with defaults are optional (can be undefined)
 * - Nullable columns are optional (can be null or undefined)
 * - Non-nullable columns without defaults are required
 */
type ComputeColumnInsertType<TType, THasDefault extends boolean> = 
  THasDefault extends true
    ? TType | undefined // Has default, so optional
    : IncludesNull<TType> extends true
      ? TType | undefined // Nullable, so optional
      : TType; // Required

/**
 * Column configuration flags
 */
export interface UColumnFlags {
  /** Whether the column has a default value (set to true after .default() is called) */
  readonly hasDefault?: boolean;
  /** Whether the column is a primary key (set to true after .primaryKey() is called) */
  readonly isPrimaryKey?: boolean;
  /** Whether the column is unique (set to true after .unique() is called) */
  readonly isUnique?: boolean;
  /** The referenced column type (set when .references() is called) */
  readonly ref?: UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder);
}

/**
 * Helper type to extract the ref type from a UColumn
 */
type ExtractRefType<T> = T extends UColumn<any, infer TFlags>
  ? TFlags extends { ref: infer TRef }
    ? TRef extends (() => infer TResolved)
      ? TResolved
      : TRef
    : undefined
  : undefined;

/**
 * Chainable unbound column builder
 * Mimics Drizzle's ColumnBuilder API but stores modifiers instead of applying them
 * 
 * @template TType - The TypeScript type that this column will produce.
 *                   For nullable columns, this includes `null` (e.g., `string | null`).
 *                   For non-nullable columns, this is just the base type (e.g., `string`).
 * @template TFlags - Configuration flags for the column (hasDefault, isPrimaryKey, isUnique)
 * 
 * @example
 * // Nullable column
 * text('name') // UColumn<string | null, {}>
 * 
 * // Non-nullable column
 * text('name').notNull() // UColumn<string, {}>
 * 
 * // Column with default
 * text('name').default('') // UColumn<string | null, { hasDefault: true }>
 * 
 * // Primary key
 * text('id').primaryKey() // UColumn<string, { isPrimaryKey: true }>
 * 
 * // Unique column
 * text('email').unique() // UColumn<string | null, { isUnique: true }>
 */
export class UColumn<
  TType = any,
  TFlags extends UColumnFlags = {}
> {
  private data: ColData;
  private _ref?: UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder);

  constructor(type: string, name: string, options?: any) {
    this.data = {
      __unbound: true,
      type,
      name,
      options,
      modifiers: [],
      nullable: true, // Columns start as nullable
    };
  }

  /**
   * Get the underlying data
   */
  getData(): ColData {
    return this.data;
  }

  /**
   * Implement SQLWrapper interface for compatibility with Drizzle's eq(), and(), etc.
   * Returns a SQL object that references this column by name.
   * This allows UColumn to be used directly with Drizzle's query builders.
   */
  getSQL(): SQL {
    // Return a SQL object that references the column by name
    // This makes UColumn compatible with Drizzle's SQLWrapper interface
    return sql.raw(`"${this.data.name}"`);
  }

  /**
   * Add .notNull() modifier
   * Returns a builder with the base type (removes null from the type)
   * Preserves the default state, primary key state, and unique state
   */
  notNull(): UColumn<BaseType<TType>, TFlags> {
    this.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: 'notNull', args: [] }],
      nullable: false, // Mark as non-nullable
    };
    return this as any;
  }

  /**
   * Add .primaryKey() modifier
   * Primary keys are always non-nullable, so this removes null from the type
   * Sets isPrimaryKey to true so we can detect it at the type level
   * Preserves the unique state and default state
   */
  primaryKey(): UColumn<BaseType<TType>, TFlags & { isPrimaryKey: true }> {
    this.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: 'primaryKey', args: [] }],
      nullable: false, // Primary keys are never nullable
    };
    return this as any;
  }

  /**
   * Add .default() modifier
   * Sets hasDefault to true
   * Preserves the primary key state and unique state
   */
  default(value: any): UColumn<TType, TFlags & { hasDefault: true }> {
    this.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: 'default', args: [value] }],
    };
    return this as any;
  }

  /**
   * Add .$type() modifier (for TypeScript type inference)
   * Usage: text('data').$type<MyType>()
   * Returns a builder with the overridden type, preserving nullable, default, primary key, and unique state
   * If the original type was nullable (included null), the new type will also be nullable
   */
  $type<T>(): UColumn<IncludesNull<TType> extends true ? T | null : T, TFlags> {
    // $type overrides the column type
    // We need to create a new instance with the overridden type
    // Check if the original type included null (nullable)
    const wasNullable = this.data.nullable;
    const newBuilder = new UColumn(this.data.type, this.data.name, this.data.options);
    newBuilder.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: '$type', args: [] }],
      typeOverride: undefined as T, // Store the type override (using undefined as a placeholder for the type)
      nullable: wasNullable, // Preserve nullable state
    };
    return newBuilder as any;
  }

  /**
   * Infer the select type from this column
   * Computed from the column TypeScript type
   * Usage: type Gender = typeof column.$inferSelect;
   * 
   * Note: Use `typeof` to access this as a type: `typeof column.$inferSelect`
   * This is a type-level property, not a runtime property.
   */
  declare readonly $inferSelect: TType;
  
  /**
   * Infer the insert type from this column
   * Columns with defaults are optional, nullable columns are optional
   * Usage: type GenderInsert = typeof column.$inferInsert;
   * 
   * Note: Use `typeof` to access this as a type: `typeof column.$inferInsert`
   * This is a type-level property, not a runtime property.
   */
  declare readonly $inferInsert: ComputeColumnInsertType<TType, TFlags extends { hasDefault: true } ? true : false>;

  /**
   * Add .unique() modifier
   * Sets isUnique to true so we can detect it at the type level
   * Preserves all other type parameters (type, default, primary key state)
   */
  unique(): UColumn<TType, TFlags & { isUnique: true }> {
    this.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: 'unique', args: [] }],
    };
    return this as any;
  }

    /**
     * Add .references() modifier for foreign key constraints
     * Usage: text('user_id').references(() => usersTable.id)
     * Usage with options: text('user_id').references(() => usersTable.id, { onDelete: 'cascade' })
     * Stores the reference as a function, UColumn, ColData, or ColumnBuilder
     */
    references<TRefColumn extends UColumn<any, any> | ColData | ColumnBuilder>(
        ref: TRefColumn | (() => TRefColumn),
        options?: {
            onDelete?: ForeignKeyAction;
            onUpdate?: ForeignKeyAction;
        }
    ): UColumn<TType, TFlags & { ref: TRefColumn }> {
        // Store the reference (function, UColumn, ColData, or ColumnBuilder)
        this._ref = typeof ref === 'function' ? ref : ref;
        // Store the reference and options in the modifier args
        const refArg = typeof ref === 'function' ? ref : () => ref;
        const args: any[] = [refArg];
        if (options) {
            args.push(options);
        }
        this.data = {
            ...this.data,
            modifiers: [...this.data.modifiers, { method: 'references', args }],
        };
        return this as any;
    }

  /**
   * Get the referenced column (if this column has a foreign key reference)
   * Usage: const refColumn = column.$ref;
   * Returns the column that this column references, resolving functions if needed
   * Returns undefined if no reference exists
   * 
   * The return type is inferred from TFlags['ref'], which is set when .references() is called
   */
  get $ref(): TFlags extends { ref: infer TRef }
    ? TRef extends (() => infer TResolved)
      ? TResolved
      : TRef
    : undefined {
    if (!this._ref) {
      return undefined as any;
    }
    // If it's a function, resolve it; otherwise return as-is
    if (typeof this._ref === 'function') {
      return this._ref() as any;
    }
    return this._ref as any;
  }

  /**
   * Add .defaultNow() modifier (for timestamp columns)
   * Usage: timestamp('created_at').defaultNow()
   * Preserves all type parameters
   */
  defaultNow(): UColumn<TType, TFlags> {
    this.data = {
      ...this.data,
      modifiers: [...this.data.modifiers, { method: 'defaultNow', args: [] }],
    };
    return this as any;
  }

  /**
   * Bind this column to a dialect
   * Returns a Drizzle ColumnBuilder
   */
  bind(dialect: SQLDialect): ColumnBuilder {
    return bindColumn(this.data, dialect);
  }

  /**
   * Support any other method that might be called
   */
  [key: string]: any;
}

// ============================================================================
// Type Aliases for Common UColumn Variations
// ============================================================================

/**
 * A nullable column (default state)
 * @example text('name') // NullableColumn<string>
 */
export type NullableColumn<TType> = UColumn<TType | null, {}>;

/**
 * A non-nullable column (after .notNull())
 * @example text('name').notNull() // NonNullableColumn<string>
 */
export type NonNullableColumn<TType> = UColumn<TType, {}>;

/**
 * A column with a default value (after .default())
 * @example text('name').default('') // ColumnWithDefault<string | null>
 */
export type ColumnWithDefault<TType> = UColumn<TType, { hasDefault: true }>;

/**
 * A unique column (after .unique())
 * @example text('email').unique() // UniqueColumn<string | null>
 */
export type UniqueColumn<TType> = UColumn<TType, { isUnique: true }>;

/**
 * A primary key column (after .primaryKey())
 * @example text('id').primaryKey() // PKColumn<string>
 */
export type PKColumn<TType> = UColumn<TType, { isPrimaryKey: true }>;

/**
 * A unique, non-nullable column
 * @example text('email').unique().notNull() // UniqueNonNullableColumn<string>
 */
export type UniqueNonNullableColumn<TType> = UColumn<TType, { isUnique: true }>;

/**
 * A unique column with a default value
 * @example text('email').unique().default('') // UniqueColumnWithDefault<string | null>
 */
export type UniqueColumnWithDefault<TType> = UColumn<TType, { hasDefault: true; isUnique: true }>;

/**
 * A primary key that is also unique
 * @example text('id').primaryKey().unique() // PKUniqueColumn<string>
 */
export type PKUniqueColumn<TType> = UColumn<TType, { isPrimaryKey: true; isUnique: true }>;

/**
 * A primary key with a default value
 * @example uuid('id').primaryKey().default(generateUUID) // PKColumnWithDefault<string>
 */
export type PKColumnWithDefault<TType> = UColumn<TType, { hasDefault: true; isPrimaryKey: true }>;

/**
 * A non-nullable column with a default value
 * @example text('name').notNull().default('') // NonNullableColumnWithDefault<string>
 */
export type NonNullableColumnWithDefault<TType> = UColumn<TType, { hasDefault: true }>;

/**
 * A unique, non-nullable column with a default value
 * @example text('email').unique().notNull().default('') // UniqueNonNullableColumnWithDefault<string>
 */
export type UniqueNonNullableColumnWithDefault<TType> = UColumn<TType, { hasDefault: true; isUnique: true }>;

/**
 * A primary key that is unique and has a default value
 * @example uuid('id').primaryKey().unique().default(generateUUID) // PKUniqueColumnWithDefault<string>
 */
export type PKUniqueColumnWithDefault<TType> = UColumn<TType, { hasDefault: true; isPrimaryKey: true; isUnique: true }>;

/**
 * Helper type to simplify UColumn to its most specific alias for better IDE display
 * This makes the type system prefer showing aliases like PKColumn, UniqueColumn, etc.
 * instead of the full generic UColumn<TType, THasDefault, TIsPrimaryKey, TIsUnique>
 * 
 * Note: This is a display-only transformation. The underlying type is still UColumn,
 * so all type operations (like ExtractColumnType) will still work correctly.
 */
export type SimplifyUColumn<T> = T extends UColumn<infer TType, infer TFlags>
  ? // If it has a ref, preserve it - don't simplify
    TFlags extends { ref: any }
    ? T  // Keep the original type to preserve ref information
    : TFlags extends { isPrimaryKey: true; hasDefault: true; isUnique: true }
    ? PKUniqueColumnWithDefault<BaseType<TType>>
    : TFlags extends { isPrimaryKey: true; hasDefault: true }
    ? PKColumnWithDefault<BaseType<TType>>
    : TFlags extends { isPrimaryKey: true; isUnique: true }
    ? PKUniqueColumn<BaseType<TType>>
    : TFlags extends { isPrimaryKey: true }
    ? PKColumn<BaseType<TType>>
    : TFlags extends { hasDefault: true; isUnique: true }
    ? UniqueColumnWithDefault<TType>
    : TFlags extends { hasDefault: true }
    ? ColumnWithDefault<TType>
    : TFlags extends { isUnique: true }
    ? IncludesNull<TType> extends true
      ? UniqueColumn<BaseType<TType>>
      : UniqueNonNullableColumn<BaseType<TType>>
    : IncludesNull<TType> extends true
      ? NullableColumn<BaseType<TType>>
      : NonNullableColumn<BaseType<TType>>
  : T extends ColData
    ? T  // Keep ColData as-is
    : T;

/**
 * Check if a column is already bound (is a ColumnBuilder, not UnboundColumnData)
 */
function isBoundColumn(column: any): column is ColumnBuilder {
  // If it has __unbound, it's unbound
  if (column && typeof column === 'object' && column.__unbound === true) {
    return false;
  }
  // If it's a ColumnBuilder, it should have certain properties
  // Drizzle ColumnBuilders have _ property and config
  return column && typeof column === 'object' && ('_' in column || 'config' in column);
}

/**
 * Try to infer the dialect from a bound column
 * Returns dialect name or null if cannot determine
 */
function getDialectFromBoundColumn(column: ColumnBuilder): string | null {
  const col = column as any;
  
  // Check the column's constructor name or prototype chain
  const constructorName = col.constructor?.name || '';
  
  // Drizzle column builders have dialect-specific class names
  // PostgreSQL: PgColumnBuilder, PgText, PgInteger, etc.
  // SQLite: SQLiteColumnBuilder, SQLiteText, SQLiteInteger, etc.
  if (constructorName.includes('Pg') || constructorName.includes('pg')) {
    return 'pg';
  }
  if (constructorName.includes('SQLite') || constructorName.includes('sqlite')) {
    return 'sqlite';
  }
  
  // Check internal config structure
  if (col._) {
    // Try to infer from internal structure
    // This is a fallback heuristic
  }
  
  // If we still can't determine, return null
  // The caller will handle this case
  return null;
}

/**
 * Bind an unbound column to a dialect
 * Also accepts already bound columns - if dialect matches, returns as-is
 */
export function bindColumn(
  column: ColData | ColumnBuilder,
  dialect: SQLDialect
): ColumnBuilder {
  // Check if already bound
  if (isBoundColumn(column)) {
    // Try to determine the dialect
    const existingDialect = getDialectFromBoundColumn(column);
    
    // If we can determine the dialect and it matches, return as-is
    if (existingDialect && existingDialect === dialect.dialectName) {
      return column;
    }
    
    // If we can determine the dialect and it doesn't match, throw error
    if (existingDialect && existingDialect !== dialect.dialectName) {
      throw new Error(
        `Column is already bound to dialect "${existingDialect}", but requested dialect is "${dialect.dialectName}"`
      );
    }
    
    // If we can't determine the dialect, we can't verify compatibility
    // In this case, we'll return the column but log a warning
    // The user should ensure they're using the correct dialect
    console.warn(
      `Cannot determine dialect of bound column. Assuming it matches requested dialect "${dialect.dialectName}". ` +
      `If you encounter errors, ensure the column is bound to the correct dialect.`
    );
    return column;
  }

  // Not bound - proceed with binding
  const unboundColumn = column as ColData;
  
  // Get the column builder function from dialect
  const builderFn = (dialect as any)[unboundColumn.type];
  if (!builderFn || typeof builderFn !== 'function') {
    throw new Error(`Column type "${unboundColumn.type}" not found in dialect "${dialect.dialectName}"`);
  }

  // Create the column builder
  let builder = builderFn(unboundColumn.name, unboundColumn.options);

  // Apply modifiers (e.g., .notNull(), .primaryKey())
  for (const modifier of unboundColumn.modifiers) {
    if (modifier.method === 'primaryKey') {
      builder = builder.primaryKey();
    } else if (modifier.method === 'notNull') {
      builder = builder.notNull();
    } else if (modifier.method === 'default' && typeof builder.default === 'function') {
        // Check if the default value is a function - if so, use $defaultFn if available
        const defaultArg = modifier.args[0];
        if (typeof defaultArg === 'function' && typeof (builder as any).$defaultFn === 'function') {
            // Use $defaultFn for function defaults (Drizzle's recommended way)
            builder = (builder as any).$defaultFn(defaultArg);
        } else {
            // Use .default() for literal values
            builder = builder.default(...modifier.args);
        }
    } else if (modifier.method === 'defaultNow') {
      // defaultNow() is equivalent to default(sql`CURRENT_TIMESTAMP`)
      // We'll use the default() method with a SQL function
      if (typeof builder.default === 'function') {
        builder = builder.default(sql`CURRENT_TIMESTAMP`);
      } else {
        console.warn(`defaultNow() not available on column builder, skipping`);
      }
    } else if (modifier.method === 'references' && typeof builder.references === 'function') {
        const refFn = () => {
            const col = modifier.args[0]();
            return bindColumn(col, dialect);
        };
        // Check if FK options were provided (second argument)
        const fkOptions = modifier.args.length > 1 ? modifier.args[1] : undefined;
        if (fkOptions && typeof fkOptions === 'object') {
            // Drizzle's references() accepts options as second parameter
            builder = (builder.references as any)(refFn, fkOptions);
        } else {
            builder = builder.references(refFn);
        }
    } else if (modifier.method === '$type' && typeof builder.$type === 'function') {
      // $type is a TypeScript-only method, but we still need to call it
      // It takes no runtime arguments
      builder = builder.$type();
    } else if (typeof builder[modifier.method] === 'function') {
      builder = builder[modifier.method](...modifier.args);
    } else {
      console.warn(`Modifier "${modifier.method}" not available on column builder, skipping`);
    }
  }

  return builder;
}

// ============================================================================
// Unbound Index and Constraint
// ============================================================================

/**
 * Unbound index definition
 * Stores index name and column references, but not yet bound to a dialect
 */
export interface UIndexData {
  readonly __unbound: true;
  readonly __type: 'index';
  readonly name: string;
  readonly columns: Array<UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder)>;
}

/**
 * Unbound unique constraint definition
 * Stores constraint name and column references, but not yet bound to a dialect
 */
export interface UUniqueData {
  readonly __unbound: true;
  readonly __type: 'unique';
  readonly name: string;
  readonly columns: Array<UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder)>;
}

/**
 * Unbound index builder
 * Mimics Drizzle's index API but stores column references instead of applying them
 */
export class UIndex {
  private data: UIndexData;

  constructor(name: string) {
    this.data = {
      __unbound: true,
      __type: 'index',
      name,
      columns: [],
    };
  }

  /**
   * Add columns to this index
   * Usage: index('user_name').on(table.name, table.email)
   */
  on(...columns: Array<UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder)>): UIndex {
    this.data = {
      ...this.data,
      columns: [...this.data.columns, ...columns],
    };
    return this;
  }

  /**
   * Get the underlying data
   */
  getData(): UIndexData {
    return this.data;
  }
}

/**
 * Unbound unique constraint builder
 * Mimics Drizzle's unique API but stores column references instead of applying them
 */
export class UUnique {
  private data: UUniqueData;

  constructor(name: string) {
    this.data = {
      __unbound: true,
      __type: 'unique',
      name,
      columns: [],
    };
  }

  /**
   * Add columns to this unique constraint
   * Usage: unique('user_email').on(table.email)
   */
  on(...columns: Array<UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder)>): UUnique {
    this.data = {
      ...this.data,
      columns: [...this.data.columns, ...columns],
    };
    return this;
  }

  /**
   * Get the underlying data
   */
  getData(): UUniqueData {
    return this.data;
  }
}

// ============================================================================
// Unbound Table
// ============================================================================


/**
 * Helper type to extract the TypeScript type from a UColumn
 * The type itself encodes nullability (if it includes null, it's nullable)
 */
type ExtractColumnType<T> = T extends UColumn<infer Type, any> ? Type : any;

/**
 * Helper type to check if a column has a default value
 */
type HasDefault<T> = T extends UColumn<any, infer TFlags> 
  ? TFlags extends { hasDefault: true } ? true : false
  : false;

/**
 * Helper type to compute the select type from columns
 * The type already includes null if the column is nullable
 */
type ComputeSelectType<TColumns extends Record<string, UColumn | ColData>> = {
  [K in keyof TColumns]: ExtractColumnType<TColumns[K]>;
};

/**
 * Helper type to check if a column should be optional in insert
 */
type IsOptionalInInsert<T> = 
  HasDefault<T> extends true
    ? true // Has default, so optional
    : IncludesNull<ExtractColumnType<T>> extends true
      ? true // Nullable, so optional
      : false; // Required

/**
 * Helper type to compute the insert type from columns
 * - Columns with defaults are optional (can be undefined) - checked first
 * - Nullable columns are optional (can be null or undefined)
 * - Non-nullable columns without defaults are required
 * Uses a single mapped type to merge required and optional fields into one cohesive type
 * Uses Exclude to remove undefined from optional properties since ? already allows undefined
 */
type ComputeInsertType<TColumns extends Record<string, UColumn | ColData>> = {
  [K in keyof TColumns as IsOptionalInInsert<TColumns[K]> extends true ? K : never]?: Exclude<ExtractColumnType<TColumns[K]>, undefined>;
} & {
  [K in keyof TColumns as IsOptionalInInsert<TColumns[K]> extends true ? never : K]: ExtractColumnType<TColumns[K]>;
} extends infer Merged ? { [K in keyof Merged]: Merged[K] } : never;

/**
 * Helper type to check if a column has a primaryKey modifier
 * For ColData, we can check the modifiers array at the type level
 * For UColumn, we check the isPrimaryKey flag in TFlags
 */
type HasPrimaryKey<T> = T extends ColData
  ? { [K in keyof T['modifiers']]: T['modifiers'][K] extends { method: 'primaryKey' } ? true : false }[number] extends true
    ? true
    : false
  : T extends UColumn<any, infer TFlags>
    ? TFlags extends { isPrimaryKey: true }
      ? true
      : false
    : false;

/**
 * Helper type to check if a column is unique
 * For ColData, we can check the modifiers array at the type level
 * For UColumn, we check the isUnique flag in TFlags
 */
type IsUnique<T> = T extends ColData
  ? { [K in keyof T['modifiers']]: T['modifiers'][K] extends { method: 'unique' } ? true : false }[number] extends true
    ? true
    : false
  : T extends UColumn<any, infer TFlags>
    ? TFlags extends { isUnique: true }
      ? true
      : false
    : false;

/**
 * Helper type to find the primary key column key in a table
 * Returns the key of the column that has a primaryKey modifier, or never if none exists
 */
type FindPrimaryKeyColumnKey<TColumns extends Record<string, UColumn<any, any> | ColData>> = {
  [K in keyof TColumns]: HasPrimaryKey<TColumns[K]> extends true ? K : never;
}[keyof TColumns];

/**
 * Helper type to get the primary key column type
 * Now that UColumn tracks TIsPrimaryKey, we can detect primary keys at the type level!
 * Returns the specific column type if a primary key exists, or undefined if none exists
 */
type GetPrimaryKeyColumn<TColumns extends Record<string, UColumn<any, any> | ColData>> = 
  FindPrimaryKeyColumnKey<TColumns> extends infer PKKey
    ? [PKKey] extends [never]
      ? undefined  // No primary key found
      : PKKey extends keyof TColumns
        ? TColumns[PKKey]  // Primary key detected, return specific column
        : undefined
    : undefined;

/**
 * Type for $primaryKey that ensures UTable<SpecificColumns> is assignable to UTable<any>
 * Since UColumn is invariant, we need to include both the specific type from GetPrimaryKeyColumn
 * and a general UColumn type. For UTable<any>, we accept any UColumn instance.
 * 
 * The key insight: when TColumns is specific, GetPrimaryKeyColumn<TColumns> returns the specific type.
 * When TColumns is any, we need to accept any UColumn type, so we use UColumn<any, any>.
 * But since UColumn is invariant, we also need to ensure the specific type is preserved.
 */
type PrimaryKeyType<TColumns extends Record<string, UColumn<any, any> | ColData>> = 
  // Include the specific primary key column type if detected
  GetPrimaryKeyColumn<TColumns> |
  // Also include general column types to allow assignment compatibility
  // This ensures UTable<SpecificColumns> can be assigned to UTable<any>
  UColumn<any, any> | ColData;

/**
 * Unbound table with columns exposed as properties and type inference
 * This intersection type allows columns to be accessed as properties (e.g., table.name)
 * and provides $inferSelect and $inferInsert type-level properties
 * 
 * The $inferSelect and $inferInsert types are computed from the column types
 * Use `typeof table.$inferSelect` to access the type.
 * 
 * Note: We define UTable as a separate type that's structurally compatible with UTable
 * but with constraints accepting UTable<any> for schema compatibility.
 */
export type UTable<TColumns extends Record<string, UColumn<any, any> | ColData> = any> = {
  readonly __unbound: true;
  readonly __name: string;
  readonly columns: Record<string, ColData>;
  /**
   * Constraints callback - accepts UTable<any> for schema compatibility
   * At runtime, the actual table passed will be UTable<TColumns> with full type information
   */
  readonly constraints?: (table: UTable<any>) => Array<UIndex | UUnique | any>;
} & {
  [K in keyof TColumns]: SimplifyUColumn<TColumns[K]>;
} & {
  /**
   * Infer the select type from this table
   * Computed from the column TypeScript types
   * Usage: type User = typeof usersTable.$inferSelect;
   * 
   * Note: Use `typeof` to access this as a type: `typeof usersTable.$inferSelect`
   */
  readonly $inferSelect: ComputeSelectType<TColumns>;
  
  /**
   * Infer the insert type from this table
   * Columns with defaults are optional, nullable columns are optional
   * Usage: type UserInsert = typeof usersTable.$inferInsert;
   * 
   * Note: Use `typeof` to access this as a type: `typeof usersTable.$inferInsert`
   */
  readonly $inferInsert: ComputeInsertType<TColumns>;
  
  /**
   * Get the primary key column from this table
   * Returns the column that has .primaryKey() modifier, or undefined if none exists
   * Usage: const pkColumn = usersTable.$primaryKey;
   *        type PkType = typeof usersTable.$primaryKey.$inferSelect;
   * 
   * Note: This is strongly typed - returns the specific column type if detected at type level,
   * or undefined if not detected (runtime will still return the correct column if it exists)
   * 
   * The union always includes UColumn<any, any> | ColData to ensure UTable<SpecificColumns>
   * is assignable to UTable<any>. For specific tables, GetPrimaryKeyColumn provides the
   * specific type, and the union allows broader compatibility.
   */
  readonly $primaryKey?: PrimaryKeyType<TColumns>;
};

/**
 * Create an unbound table
 * Columns are exposed as properties on the returned table object for use in references
 * 
 * @example
 * ```typescript
 * import { table, text, uuid } from './unbound';
 * 
 * const usersTable = table('users', {
 *   id: uuid('id').primaryKey(),  // ✅ Unbound column builder
 *   name: text('name'),            // ✅ Unbound column builder
 * });
 * ```
 * 
 * **Important:** Only accepts unbound columns (UnboundColumnBuilder or UnboundColumnData).
 * Bound Drizzle ColumnBuilder instances will cause a TypeScript error.
 * 
 * If you're getting a type error about ColumnBuilder, make sure you're importing
 * column builders from the unbound module, not from drizzle-orm directly:
 * 
 * ❌ Wrong: `import { text } from 'drizzle-orm/pg-core'`
 * ✅ Correct: `import { text } from './unbound'`
 * 
 * @throws Error at runtime if any column is a bound Drizzle ColumnBuilder.
 */
export function unboundTable<
  TColumns extends Record<string, UColumn<any, any> | ColData> = Record<string, UColumn<any, any> | ColData>
>(
  name: string,
  columns: TColumns,
  constraints?: (table: UTable<any>) => Array<UIndex | UUnique | any>
): UTable<TColumns> {
  // Convert UnboundColumnBuilder instances to data
  // Use Record<string, ColData> for runtime storage (doesn't affect type inference)
    const columnData: Partial<Record<keyof TColumns, ColData>> = {};

    // Store original column builders/data for property access
  // Use TColumns type to preserve specific column types instead of Record<string, UColumn | ColData>
  const columnBuilders = {} as TColumns;
  
  // Iterate over columns using keyof to preserve types
  for (const key in columns) {
    if (!columns.hasOwnProperty(key)) continue;
    
    const column = columns[key];
    
    // Check if it's a bound column - if so, throw error
    if (isBoundColumn(column)) {
      throw new Error(
        `Cannot create unbound table "${name}" with bound column "${key}". ` +
        `Unbound tables can only contain unbound columns. ` +
        `If you need to use bound columns, create the table directly with the dialect's table builder.`
      );
    }
    
    // Store the original builder/data for property access
    // Type assertion is safe because we've already checked it's not a bound column
    (columnBuilders as any)[key] = column;
    
    if (column instanceof UColumn) {
      columnData[key] = column.getData();
    } else {
      // Must be UnboundColumnData at this point
      columnData[key] = column as ColData;
    }
  }

  // Create the base table object
  // Wrap constraints callback to ensure it accepts UTable<any> for schema compatibility
  // At runtime, the actual table passed will be UTable<TColumns> with full type information
  const wrappedConstraints = constraints ? ((table: UTable<any>) => {
    // Call the original constraints callback - at runtime, table is UTable<TColumns>
    return constraints(table);
  }) : undefined;

  const baseTable = {
    __unbound: true,
    __name: name,
    columns: columnData,
    constraints: wrappedConstraints,
  };
  
  // Find the primary key column (if any) at runtime
  let primaryKeyColumn: UColumn<any, any> | ColData | undefined = undefined;
  for (const key in columns) {
    if (!columns.hasOwnProperty(key)) continue;
    
    const column = columns[key];
    let hasPrimaryKey = false;
    
    if (column instanceof UColumn) {
      const data = column.getData();
      hasPrimaryKey = data.modifiers.some(m => m.method === 'primaryKey');
    } else {
      // Must be ColData
      const data = column as ColData;
      hasPrimaryKey = data.modifiers.some(m => m.method === 'primaryKey');
    }
    
    if (hasPrimaryKey) {
      primaryKeyColumn = column;
      break; // Take the first primary key found
    }
  }

  // Create table object with columns exposed as properties
  // The types are computed at the type level using ComputeSelectType and ComputeInsertType
  // We use the original columns parameter directly to preserve literal types
  // Even if some columns have complex types, we preserve the literal object structure
  const result = {
    ...baseTable,
    // Expose columns as properties for use in references (e.g., usersTable.name)
    // Use the original columns parameter to preserve specific types
    // TypeScript will preserve the literal object type even with mixed column types
    ...columns,
    // Add $primaryKey getter that returns the primary key column
    // Type assertion is needed because runtime type doesn't match type-level inference
    get $primaryKey(): GetPrimaryKeyColumn<TColumns> {
      return primaryKeyColumn as GetPrimaryKeyColumn<TColumns>;
    },
  } as UTable<TColumns>;
  
  return result;
}

/**
 * Try to infer the dialect from a bound table
 * Returns dialect name or null if cannot determine
 */
function getDialectFromBoundTable(table: Table): string | null {
  const tbl = table as any;
  
  // Check the table's constructor name or prototype chain
  const constructorName = tbl.constructor?.name || '';
  
  // Drizzle tables have dialect-specific class names
  // PostgreSQL: PgTable, PgTableExtraConfig, etc.
  // SQLite: SQLiteTable, SQLiteTableExtraConfig, etc.
  if (constructorName.includes('Pg') || constructorName.includes('pg')) {
    return 'pg';
  }
  if (constructorName.includes('SQLite') || constructorName.includes('sqlite')) {
    return 'sqlite';
  }
  
  // Check internal structure for dialect hints
  if (tbl._) {
    // Try to check internal properties
    // PostgreSQL tables might have schema info
    if (tbl._.schema !== undefined) {
      return 'pg';
    }
  }
  
  // Try to infer from the table's columns if available
  // Check a sample column to see if we can determine dialect
  if (tbl[Symbol.for('drizzle:Columns')] || tbl._?.columns) {
    const columns = tbl[Symbol.for('drizzle:Columns')] || tbl._?.columns;
    if (columns && typeof columns === 'object') {
      // Get first column and check its dialect
      const firstColumnKey = Object.keys(columns)[0];
      if (firstColumnKey) {
        const firstColumn = columns[firstColumnKey];
        const columnDialect = getDialectFromBoundColumn(firstColumn);
        if (columnDialect) {
          return columnDialect;
        }
      }
    }
  }
  
  // If we still can't determine, return null
  return null;
}

/**
 * Check if a value is an unbound index
 */
function isUnboundIndex(value: any): value is UIndex {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof UIndex) return true;
  // Check if it has the index data structure
  const data = value.getData ? value.getData() : value;
  return data && data.__unbound === true && data.__type === 'index';
}

/**
 * Check if a value is an unbound unique constraint
 */
function isUnboundUnique(value: any): value is UUnique {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof UUnique) return true;
  // Check if it has the unique data structure
  const data = value.getData ? value.getData() : value;
  return data && data.__unbound === true && data.__type === 'unique';
}

/**
 * Resolve a column reference (could be UColumn, ColData, ColumnBuilder, or a function)
 * Returns a bound ColumnBuilder
 */
function resolveColumnReference(
  columnRef: UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder),
  dialect: SQLDialect
): ColumnBuilder {
  // If it's a function, call it first
  if (typeof columnRef === 'function') {
    columnRef = columnRef();
  }
  
  // If it's already a bound ColumnBuilder, return as-is
  if (isBoundColumn(columnRef)) {
    return columnRef;
  }
  
  // If it's a UColumn, convert to ColData first
  if (columnRef instanceof UColumn) {
    columnRef = columnRef.getData();
  }
  
  // Otherwise, bind it (should be ColData at this point)
  return bindColumn(columnRef, dialect);
}

/**
 * Get the column name from a column reference
 */
function getColumnName(columnRef: UColumn<any, any> | ColData | ColumnBuilder | (() => UColumn<any, any> | ColData | ColumnBuilder)): string {
  // If it's a function, call it first
  if (typeof columnRef === 'function') {
    columnRef = columnRef();
  }
  
  // If it's a UColumn, get the name from its data
  if (columnRef instanceof UColumn) {
    return columnRef.getData().name;
  }
  
  // If it's ColData, get the name directly
  if (columnRef && typeof columnRef === 'object' && '__unbound' in columnRef && 'name' in columnRef) {
    return (columnRef as ColData).name;
  }
  
  // If it's a ColumnBuilder, try to get the name from its config
  if (columnRef && typeof columnRef === 'object' && 'config' in columnRef) {
    const config = (columnRef as any).config;
    if (config && typeof config === 'object' && 'name' in config) {
      return config.name;
    }
  }
  
  // Fallback: try to get name from _ property (Drizzle internal structure)
  if (columnRef && typeof columnRef === 'object' && '_' in columnRef) {
    const internal = (columnRef as any)._;
    if (internal && typeof internal === 'object' && 'name' in internal) {
      return internal.name;
    }
  }
  
  throw new Error('Cannot determine column name from column reference');
}

/**
 * Bind an unbound index to a dialect using column instances from a table
 */
function bindIndexWithColumns(index: UIndex, tableColumns: Record<string, any>, dialect: SQLDialect): any {
  const indexData = index.getData();
  const indexBuilder = dialect.index;
  
  // Get column names from the unbound column references
  const columnNames = indexData.columns.map(col => getColumnName(col));
  
  // Look up the actual Column instances from the table columns
  const boundColumns = columnNames.map(name => {
    if (!(name in tableColumns)) {
      // Try to find the column by iterating through all columns
      // Sometimes column names might be stored differently
      const foundColumn = Object.values(tableColumns).find((col: any) => {
        const colName = col?.name || col?.config?.name || col?._?.name;
        return colName === name;
      });
      if (foundColumn) {
        return foundColumn;
      }
      throw new Error(`Column "${name}" not found in table columns. Available columns: ${Object.keys(tableColumns).join(', ')}`);
    }
    return tableColumns[name];
  }).filter(col => col != null); // Filter out any null/undefined columns
  
  // Validate that we have at least one column
  if (boundColumns.length === 0) {
    throw new Error(`Index "${indexData.name}" has no valid columns`);
  }
  
  // Create the bound index using the dialect's index builder
  // Drizzle's index().on() pattern: index(name).on(col1, col2, ...)
  // The index builder returns an object with an .on() method (even though TypeScript types don't show it)
  // Pass an empty object for options when no options are provided (Drizzle expects an object, not undefined)
  const boundIndex = indexBuilder(indexData.name, {} as any) as any;
  if (typeof boundIndex.on === 'function') {
    return boundIndex.on(...boundColumns);
  }
  // Fallback: if .on() doesn't exist, return the index as-is (shouldn't happen with Drizzle)
  return boundIndex;
}

/**
 * Bind an unbound unique constraint to a dialect using column instances from a table
 */
function bindUniqueWithColumns(unique: UUnique, tableColumns: Record<string, any>, dialect: SQLDialect): any {
  const uniqueData = unique.getData();
  const uniqueBuilder = dialect.unique;
  
  // Get column names from the unbound column references
  const columnNames = uniqueData.columns.map(col => getColumnName(col));
  
  // Look up the actual Column instances from the table columns
  const boundColumns = columnNames.map(name => {
    if (!(name in tableColumns)) {
      // Try to find the column by iterating through all columns
      // Sometimes column names might be stored differently
      const foundColumn = Object.values(tableColumns).find((col: any) => {
        const colName = col?.name || col?.config?.name || col?._?.name;
        return colName === name;
      });
      if (foundColumn) {
        return foundColumn;
      }
      throw new Error(`Column "${name}" not found in table columns. Available columns: ${Object.keys(tableColumns).join(', ')}`);
    }
    return tableColumns[name];
  }).filter(col => col != null); // Filter out any null/undefined columns
  
  // Validate that we have at least one column
  if (boundColumns.length === 0) {
    throw new Error(`Unique constraint "${uniqueData.name}" has no valid columns`);
  }
  
  // Create the bound unique constraint using the dialect's unique builder
  // Drizzle's unique().on() pattern: unique(name).on(col1, col2, ...)
  // The unique builder returns an object with an .on() method (even though TypeScript types don't show it)
  // Pass an empty object for options when no options are provided (Drizzle expects an object, not undefined)
  const boundUnique = uniqueBuilder(uniqueData.name, {} as any) as any;
  if (typeof boundUnique.on === 'function') {
    return boundUnique.on(...boundColumns);
  }
  // Fallback: if .on() doesn't exist, return the unique as-is (shouldn't happen with Drizzle)
  return boundUnique;
}

/**
 * Bind an unbound table to a dialect
 * Also accepts already bound tables - if dialect matches, returns as-is
 */
export function bindTable(
  table: UTable<any> | Table,
  dialect: SQLDialect
): Table {
  // Check if already bound
  if (!isUTable(table)) {
    const boundTable = table as Table;
    
    // Try to determine the dialect
    const existingDialect = getDialectFromBoundTable(boundTable);
    
    // If we can determine the dialect and it matches, return as-is
    if (existingDialect && existingDialect === dialect.dialectName) {
      return boundTable;
    }
    
    // If we can determine the dialect and it doesn't match, throw error
    if (existingDialect && existingDialect !== dialect.dialectName) {
      throw new Error(
        `Table is already bound to dialect "${existingDialect}", but requested dialect is "${dialect.dialectName}"`
      );
    }
    
    // If we can't determine the dialect, we can't verify compatibility
    // In this case, we'll return the table but log a warning
    // The user should ensure they're using the correct dialect
    console.warn(
      `Cannot determine dialect of bound table. Assuming it matches requested dialect "${dialect.dialectName}". ` +
      `If you encounter errors, ensure the table is bound to the correct dialect.`
    );
    return boundTable;
  }

  // Not bound - proceed with binding
  const unboundTable = table as UTable<any>;
  
  // Bind all columns
  const boundColumns: Record<string, ColumnBuilder> = {};
  for (const [key, column] of Object.entries(unboundTable.columns)) {
    boundColumns[key] = bindColumn(column as ColData, dialect);
  }

  // Create the table using the dialect's table builder
  // If there are constraints, we need to resolve them using the bound table's columns
  const tableBuilder = dialect.table;
  
  if (unboundTable.constraints) {
    // Create a constraints callback that receives the bound table from Drizzle
    // Drizzle calls this callback with the fully initialized table, so columns will be available
    const constraintsCallback = (boundTable: Table) => {
      // Access columns from the bound table (which Drizzle provides fully initialized)
      let tableColumns: Record<string, any> = {};
      
      // Try multiple ways to access columns
      if ((boundTable as any).columns && typeof (boundTable as any).columns === 'object') {
        tableColumns = (boundTable as any).columns;
      } else {
        // Try accessing columns as properties on the table object
        for (const key of Object.keys(boundColumns)) {
          const column = (boundTable as any)[key];
          if (column && typeof column === 'object' && (column.name || column.config || column._)) {
            tableColumns[key] = column;
          }
        }
      }
      
      // Create a mapping from column name to Column instance
      const tableColumnsByName: Record<string, any> = {};
      for (const [key, column] of Object.entries(tableColumns)) {
        if (column) {
          // Get the column name from the column instance
          const colName = (column as any).name || (column as any).config?.name || (column as any)._?.name || key;
          tableColumnsByName[colName] = column;
          // Also store by key in case the key matches the name
          if (key === colName) {
            tableColumnsByName[key] = column;
          }
        }
      }
      
      // Also add columns by their property keys
      Object.assign(tableColumnsByName, tableColumns);
      
      // Call the original constraints callback with the unbound table to get constraint definitions
      const constraintsResult = unboundTable.constraints!(table as any);
      
      // Convert unbound indexes/constraints to bound ones using the table's columns
      return constraintsResult.map((constraint: any) => {
        if (isUnboundIndex(constraint)) {
          return bindIndexWithColumns(constraint, tableColumnsByName, dialect);
        } else if (isUnboundUnique(constraint)) {
          return bindUniqueWithColumns(constraint, tableColumnsByName, dialect);
        } else {
          // Already bound constraint, return as-is
          return constraint;
        }
      });
    };
    
    return tableBuilder(unboundTable.__name, boundColumns, constraintsCallback);
  } else {
    return tableBuilder(unboundTable.__name, boundColumns);
  }
}

/**
 * Check if a value is an unbound table
 */
export function isUTable(value: any): value is UTable<any> {
  return value && typeof value === 'object' && value.__unbound === true && value.__name !== undefined;
}




// ============================================================================
// Unbound Dialect Implementation
// ============================================================================

// Helper type to extract enum type from VarcharConfig
// This extracts the enum array type and converts it to a union type
type ExtractEnumType<T> = T extends { enum: infer E }
    ? E extends readonly string[]
        ? E[number]  // Extract union type from readonly tuple
        : E extends string[]
            ? E[number]  // Extract union type from mutable array
            : string  // Has enum property but not a string array, default to string
    : string;  // No enum property, default to string

// Helper function for varchar that handles enum types
// Extracts enum type from the config parameter
// Note: TypeScript widens array literals to string[] unless 'as const' is used
// For literal enum types (e.g., ['male', 'female']), use 'as const' to preserve the literal type
function unboundVarchar<
    const TConfig extends VarcharConfig | undefined = undefined
>(
    name: string, 
    opts?: TConfig
): UColumn<ExtractEnumType<TConfig> | null> {
    // TypeScript will infer the correct type from the return type annotation
    // The actual runtime value doesn't matter for type inference
    // Columns are nullable by default, so we include | null
    return new UColumn('varchar', name, opts) as any;
}

const unboundColumnBuildersBase: BaseDialectColumnBuilders = {
    text: (name: string, opts?: TextOptions) => new UColumn<string | null>('text', name, opts) as any,
    varchar: unboundVarchar as any,
    json: (name: string, opts?: JsonOptions) => new UColumn<any | null>('json', name, opts) as any,
    jsonb: (name: string, opts?: JsonOptions) => new UColumn<any | null>('jsonb', name, opts) as any,
    integer: (name: string, opts?: IntegerOptions) => new UColumn<number | null>('integer', name, opts) as any,
    real: (name: string, opts?: RealOptions) => new UColumn<number | null>('real', name, opts) as any,
    doublePrecision: (name: string, opts?: RealOptions) => new UColumn<number | null>('doublePrecision', name, opts) as any,
    bigint: (name: string, opts?: BigintOptions) => new UColumn<bigint | null>('bigint', name, opts) as any,
    smallint: (name: string, opts?: SmallintOptions) => new UColumn<number | null>('smallint', name, opts) as any,
    pkserial: (name: string) => new UColumn<number | null>('pkserial', name) as any,
    blob: (name: string, opts?: BlobOptions) => new UColumn<Uint8Array | null>('blob', name, opts) as any,
    numeric: (name: string, opts?: NumericConfig) => new UColumn<string | null>('numeric', name, opts) as any,
    bool: (name: string, opts?: BooleanOptions) => new UColumn<boolean | null>('bool', name, opts) as any,
    boolean: (name: string, opts?: BooleanOptions) => new UColumn<boolean | null>('boolean', name, opts) as any,
    date: (name: string, opts?: DateOptions) => new UColumn<Date | null>('date', name, opts) as any,
    time: (name: string, opts?: TimeOptions) => new UColumn<string | null>('time', name, opts) as any,
    timestamp: (name: string, opts?: TimestampOptions) => new UColumn<Date | null>('timestamp', name, opts) as any,
};
const unboundColumnBuilders = extendDialectWithComposedBuilders(unboundColumnBuildersBase);

// Unbound index builder function
const unboundIndex = (name: string): UIndex => {
  return new UIndex(name);
};

// Unbound unique constraint builder function
const unboundUnique = (name: string): UUnique => {
  return new UUnique(name);
};

const unboundBuilders: DialectBuilders = {
    table: unboundTable as any,
    ...unboundColumnBuilders,
    unique: unboundUnique as any,
    index: unboundIndex as any,
    check: notImplementedForDialect("check constraint", "unbound"),
};

const dialectName = "unbound";
const unboundDialect: SQLDialect = {
    dialectName,
    ...unboundBuilders,

    getTableNames: async (db: DrizzleDatabaseConnectionDriver, schemaName: string = 'public'): Promise<string[]> => {
        throw new NotImplementedError("getTableNames not implemented for unbound dialect");
    },

    getSchemaNames: async (
        db: DrizzleDatabaseConnectionDriver,
        options?: { excludeBuiltins?: boolean }
    ): Promise<string[]> => {
        throw new NotImplementedError("getSchemaNames not implemented for unbound dialect");
    },

    getTableColumns: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName: string = 'public'
    ): Promise<DrizzleColumnInfo[]> => {
        throw new NotImplementedError("getTableColumns not implemented for unbound dialect");
    },
    getRuntimeTable: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string,
    ): Promise<Table> => {
    throw new NotImplementedError("getRuntimeTable not implemented for unbound dialect");
    },
    
    getTablePrimaryKeys: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ): Promise<PrimaryKeyInfo[]> => {
        throw new NotImplementedError("getTablePrimaryKeys not implemented for unbound dialect");
    },
    
    getTableForeignKeys: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ): Promise<ForeignKeyInfo[]> => {
        throw new NotImplementedError("getTableForeignKeys not implemented for unbound dialect");
    },
    
    getTableUniqueConstraints: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ): Promise<UniqueConstraintInfo[]> => {
        throw new NotImplementedError("getTableUniqueConstraints not implemented for unbound dialect");
    },
    
    getTableIndexes: async (
        db: DrizzleDatabaseConnectionDriver,
        tableName: string,
        schemaName?: string
    ): Promise<IndexInfo[]> => {
        throw new NotImplementedError("getTableIndexes not implemented for unbound dialect");
    },
};


// Export the dialect and all builders
export default unboundDialect;

// Export all column builders with proper types
// These ensure that method chaining preserves UnboundColumnBuilder type with the correct TypeScript type
export const text: (name: string, opts?: TextOptions) => UColumn<string | null> = unboundColumnBuilders.text as any;
// Export varchar function that extracts enum type from config
// Using const modifier to preserve literal types in the config
export function varchar<
    const TConfig extends VarcharConfig | undefined = undefined
>(
    name: string, 
    opts?: TConfig
): UColumn<ExtractEnumType<TConfig> | null> {
    return unboundVarchar(name, opts);
}
export const json = unboundColumnBuilders.json;
export const jsonb = unboundColumnBuilders.jsonb;
export const integer = unboundColumnBuilders.integer;
export const real = unboundColumnBuilders.real;
export const doublePrecision = unboundColumnBuilders.doublePrecision;
export const bigint = unboundColumnBuilders.bigint;
export const smallint = unboundColumnBuilders.smallint;
export const pkserial = unboundColumnBuilders.pkserial;
export const blob = unboundColumnBuilders.blob;
export const numeric = unboundColumnBuilders.numeric;
export const bool = unboundColumnBuilders.bool;
export const boolean = unboundColumnBuilders.boolean;
export const timestamp = unboundColumnBuilders.timestamp;
export const time = unboundColumnBuilders.time;
export const date = unboundColumnBuilders.date;
export const uuid = unboundColumnBuilders.uuid;
export const uuidDefault = unboundColumnBuilders.uuidDefault;
export const uuidPK = unboundColumnBuilders.uuidPK;


// Export table builder with const modifier to preserve literal types
// Using UColumn<any, any> in the constraint allows complex types while preserving literal structure
export function table<
  TColumns extends Record<string, UColumn<any, any> | ColData> = Record<string, UColumn<any, any> | ColData>
>(
  name: string,
  columns: TColumns,
  constraints?: (table: UTable<any>) => Array<UIndex | UUnique | any>
): UTable<TColumns> {
  return unboundTable(name, columns, constraints);
}

// Export constraint builders
export const unique = unboundUnique;
export const index = unboundIndex;
export const check = unboundBuilders.check;

