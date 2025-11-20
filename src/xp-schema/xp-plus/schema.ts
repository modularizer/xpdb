import {Schema} from "../xp-sql/schema";
import {Table} from "drizzle-orm";
import {DbConnectionInfo} from "../xp-sql/drivers/types";
import {connect, XPDatabaseConnectionPlus, XPDatabaseConnectionPlusWithTables} from "./database";
import {UTable} from "../xp-sql/dialects";
// Note: genTypesScript, genCreateScript, and genMigrationsScript are Node.js-only utilities
// They are imported lazily to avoid bundling issues in web environments
import {getSchemaJson as getSchemaJsonUtil} from '../xp-sql/utils/schema-extraction/extract-schema-metadata';
import type {SQLDialect} from '../xp-sql/dialects/types';

/**
 * XPSchemaPlus with tables exposed as properties
 * This type allows tables to be accessed as properties (e.g., schema.users, schema.posts)
 */
export type XPSchemaPlusWithTables<Tables extends Record<string, Table | UTable<any>>> =
  XPSchemaPlus<Tables> & {
    readonly [K in keyof Tables]: Tables[K];
  };

export class XPSchemaPlus<Tables extends Record<string, Table | UTable<any>> = Record<string, Table | UTable<any>>> extends Schema<Tables> {
    constructor(tables: Tables, public anchor?: string) {
        super(tables);
    }

    async gen({src, dst, types = true, creates = ['pg', 'sqlite'], migrations = true}: {src?: string, dst?: string, types?: boolean, creates?: string[] | boolean | undefined | null, migrations?: string[] | boolean | undefined | null} = {}) {
        if (types){
            await this.genTypesScript(src, dst);
        }
        if (creates){
            await this.genCreateScript(src, dst, (creates === true)?undefined:creates);
        }
        if (migrations){
            await this.genMigrationsScript(src, dst, (migrations === true)?undefined:migrations);
        }
    }
    async genTypesScript(anchor?: string, dst?: string) {
        const a = anchor ?? this.anchor;
        if (!a){throw new Error('must provide filename')}
        // Use require() directly (this method is only called in Node.js contexts)
        if (typeof require === 'undefined') {
            throw new Error('genTypesScript is only available in Node.js environments.');
        }
        try {
            const { genTypesScript } = require("../utils/generate-types");
            return genTypesScript(a, dst);
        } catch (error) {
            if (typeof window !== 'undefined') {
                throw new Error('genTypesScript is only available in Node.js environments. This is a development tool that cannot run in web browsers.');
            }
            throw error;
        }
    }
    async genCreateScript(anchor?: string, dst?: string, dialects?: string[]){
        const a = anchor ?? this.anchor;
        if (!a){throw new Error('must provide filename')}
        // Lazy import to avoid bundling Node.js-only code in web environments
        // Use require() directly (this method is only called in Node.js contexts)
        if (typeof require === 'undefined') {
            throw new Error('genCreateScript is only available in Node.js environments.');
        }
        try {
            const { genCreateScript } = require('../utils/generate-create-script');
            return genCreateScript(a, dst, dialects);
        } catch (error) {
            if (typeof window !== 'undefined') {
                throw new Error('genCreateScript is only available in Node.js environments. This is a development tool that cannot run in web browsers.');
            }
            throw error;
        }
    }
    async genMigrationsScript(anchor?: string, dst?: string, dialects?: string[]){
        const a = anchor ?? this.anchor;
        if (!a){throw new Error('must provide filename')}
        // Use require() directly (this method is only called in Node.js contexts)
        if (typeof require === 'undefined') {
            throw new Error('genMigrationsScript is only available in Node.js environments.');
        }
        try {
            const { genMigrationsScript } = require('../xp-sql/utils/migrations/migration-generator');
            return genMigrationsScript(a, dst, dialects);
        } catch (error) {
            if (typeof window !== 'undefined') {
                throw new Error('genMigrationsScript is only available in Node.js environments. This is a development tool that cannot run in web browsers.');
            }
            throw error;
        }
    }

    /**
     * Get schema JSON representation
     * Returns a JSON-serializable representation of the schema metadata
     * 
     * @param dialect - Optional dialect to include dialect-specific type information
     * @returns JSON-serializable schema metadata
     */
    async getSchemaJson(dialect?: SQLDialect): Promise<Record<string, any>> {
        return getSchemaJsonUtil(this, dialect);
    }

    async connect(connectionInfo: DbConnectionInfo): Promise<XPDatabaseConnectionPlusWithTables<Tables>> {
        // Pass unbound schema directly - registerSchema will bind it to the correct dialect
        // Type assertion is safe because registerSchema handles both bound and unbound tables
        // The tables will be bound during connection, but we preserve the original types for TypeScript
        return connect(connectionInfo, this.tables) as Promise<XPDatabaseConnectionPlusWithTables<Tables>>;
    }
}

export function xpschema<Tables extends Record<string, Table | UTable<any>>>(
    tables: Tables,
    anchor?: string
): XPSchemaPlusWithTables<Tables> {
    return new XPSchemaPlus(tables, anchor) as XPSchemaPlusWithTables<Tables>;
}
