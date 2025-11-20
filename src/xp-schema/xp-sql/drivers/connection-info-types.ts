/**
 * Driver-specific connection info types
 * 
 * These types are extracted to a separate file to avoid Metro bundler
 * trying to resolve platform-specific packages when these types are imported.
 */

import type { DbConnectionInfo } from './types';

/**
 * Postgres connection configuration types
 */
type PgCommonOptions = {
    ssl?: boolean | object;
    max?: number; // max connections
    idle_timeout?: number;
    connect_timeout?: number;
    onnotice?: (msg: string) => void;
};

type PgConnectionStringConfig = PgCommonOptions & {
    connectionString: string;
    host?: never;
    user?: never;
    password?: never;
    port?: never;
    database?: never;
};

type PgDiscreteConfig = PgCommonOptions & {
    connectionString?: never;
    host: string;
    user: string;
    database: string;
    password?: string;
    port?: number;
};

/**
 * Postgres connection info type
 * Can be used in React Native/Expo without importing the postgres package
 */
export type PostgresConnectionInfo =
    DbConnectionInfo & (PgConnectionStringConfig | PgDiscreteConfig);

