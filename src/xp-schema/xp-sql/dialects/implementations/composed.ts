/**
 * Composed Column Builders
 * 
 * These are utility column builders that compose existing base column builders.
 * They work across all dialects since they're built on top of dialect-agnostic builders
 * like varchar, text, etc.
 * 
 * These are automatically added to all dialects via the extendDialectWithComposedBuilders function.
 * Each dialect doesn't need to implement them - they're composed from the dialect's own varchar function.
 * 
 * IMPORTANT: These builders work with unbound columns (UColumn) to avoid issues with Drizzle's
 * internal handling of function defaults on bound column builders.
 */

import type {BaseDialectColumnBuilders, ColumnBuilderFn, DialectColumnBuilders, VarcharConfig} from '../types';
import type { ColumnBuilderWithReferences } from '../types';
import { generateUUID } from '../../utils/misc/uuid';
import { varchar as unboundVarchar, type UColumn } from './unbound';

/**
 * Composed column builders interface
 * These are added to all dialects automatically
 */
export interface ComposedColumnBuilders {
    /**
     * UUID column builder - creates a varchar column with default length of 16
     * @param name Column name
     * @param options Optional configuration (length defaults to 16)
     * @returns A varchar column configured for UUIDs
     * 
     * @example
     * ```ts
     * const id = uuid('id'); // varchar(16)
     * const customId = uuid('id', { length: 32 }); // varchar(32)
     * ```
     */
    uuid: (name: string, options?: { length?: number }) => ColumnBuilderWithReferences;
    
    /**
     * UUID column with default value generator
     * Creates a varchar column that automatically generates a UUID on insert
     * @param name Column name
     * @param options Optional configuration (length defaults to 16)
     * @returns A varchar column with auto-generated UUID default
     * 
     * @example
     * ```ts
     * const id = uuidDefault('id'); // varchar(16) with default generateUUID(16)
     * ```
     */
    uuidDefault: (name: string, options?: { length?: number }) => ColumnBuilderWithReferences;
    
    /**
     * UUID primary key column with default value generator
     * Creates a varchar column that is a primary key and automatically generates a UUID on insert
     * @param name Column name
     * @param options Optional configuration (length defaults to 16)
     * @returns A varchar column that is a primary key with auto-generated UUID default
     * 
     * @example
     * ```ts
     * const id = uuidPK('id'); // varchar(16) PRIMARY KEY with default generateUUID(16)
     * ```
     */
    uuidPK: (name: string, options?: { length?: number }) => ColumnBuilderWithReferences;
}

/**
 * Creates composed column builders using unbound columns
 * This avoids issues with Drizzle's internal handling of function defaults on bound builders.
 * The unbound columns will be bound to the correct dialect when used in tables.
 */
export function createComposedBuilders(
    varchar: ColumnBuilderFn<VarcharConfig>
): ComposedColumnBuilders {
    const defaultLength = 16;
    
    // Use unbound varchar to avoid issues with function defaults on bound builders
    // When these are used in tables, they'll be automatically bound to the correct dialect
    const uuid = (name: string, { length = defaultLength }: { length?: number } = {}): ColumnBuilderWithReferences => {
        const unbound = unboundVarchar(name, { length });
        // Cast to bound builder type - will be properly bound when used in table
        return unbound as any as ColumnBuilderWithReferences;
    }
    
    const uuidDefault = (name: string, { length = defaultLength }: { length?: number } = {}): ColumnBuilderWithReferences => {
        // Use unbound column to avoid $defaultFn issues with bound builders
        const unbound = unboundVarchar(name, { length });
        // Use $defaultFn() - Drizzle's recommended way for function defaults
        const withDefault = unbound.$defaultFn(() => generateUUID(length));
        // Cast to bound builder type - will be properly bound when used in table
        return withDefault as any as ColumnBuilderWithReferences;
    }
    
    const uuidPK = (name: string, { length = defaultLength }: { length?: number } = {}): ColumnBuilderWithReferences => {
        // Use unbound column to avoid $defaultFn issues with bound builders
        const unbound = unboundVarchar(name, { length });
        // Use $defaultFn() - Drizzle's recommended way for function defaults
        const withDefault = unbound.$defaultFn(() => generateUUID(length));
        // @ts-ignore - primaryKey() returns UColumn, we cast to bound builder type
        const withPK = withDefault.primaryKey();
        // Cast to bound builder type - will be properly bound when used in table
        return withPK as any as ColumnBuilderWithReferences;
    }

    return {
        uuid,
        uuidDefault,
        uuidPK,
    };
}

/**
 * Extends a dialect's column builders with composed builders
 * This function takes any dialect's column builders and adds the composed builders
 * (uuid, uuidDefault, uuidPK) to it
 */
export function extendDialectWithComposedBuilders(
    builders: BaseDialectColumnBuilders
): DialectColumnBuilders {
    const composed = createComposedBuilders(builders.varchar);
    return {
        ...builders,
        ...composed,
    };
}

