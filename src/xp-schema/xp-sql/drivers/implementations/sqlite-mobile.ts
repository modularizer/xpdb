// sqlite-mobile.ts
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system";
// Dynamic import - import inside function to prevent Metro from analyzing
import {
    DrizzleDatabaseConnectionDriver,
    connectFn,
    DbConnectionInfo, XPDriverImpl,
} from "../types";
import {SQL} from "drizzle-orm";
import {PlatformName} from "../../../platform";



export type SqliteMobileConnectionInfo = DbConnectionInfo & {
    name: string;
    enableForeignKeys?: boolean;
};


function getExpoDb(info: SqliteMobileConnectionInfo): SQLite.SQLiteDatabase {

    // name-branch
    return SQLite.openDatabaseSync(info.name);
}

const driverDetails = {
    dialectName: 'sqlite',
    driverName: 'sqlite-mobile',
    clientPlatforms: {
        [PlatformName.WEB]: false,
        [PlatformName.MOBILE]: true,
        [PlatformName.NODE]: false,
    },
    hostPlatforms: {
        [PlatformName.WEB]: false,
        [PlatformName.MOBILE]: true,
        [PlatformName.NODE]: false,
    },
}

const connectToSqliteMobile: connectFn<SqliteMobileConnectionInfo> = async (
    info: SqliteMobileConnectionInfo
) => {
    // Dynamic import to prevent Metro from analyzing
    const { drizzle } = await import('drizzle-orm/expo-sqlite');
    const expoDb = getExpoDb(info);
    const db = drizzle(expoDb) as any; // ExpoSQLiteDatabase

    db.raw = expoDb;
    db.connInfo = { ...info, dialectName: 'sqlite', driverName: 'sqlite-mobile' };
    Object.assign(db, driverDetails);
    
    // Normalize execute() to return consistent QueryResult format
    const originalExecute = db.execute?.bind(db) || db.run?.bind(db);
    db.execute = async (query: SQL) => {
        const result = await originalExecute(query);
        // Expo SQLite's run() returns {changes: number, lastInsertRowId: number}
        // Drizzle's execute() may return array or result object
        if (Array.isArray(result)) {
            return { rows: result };
        } else if (result && typeof result === 'object') {
            if ('rows' in result) {
                // Already has rows property
                return {
                    rows: result.rows || [],
                    columns: result.columns,
                    rowCount: result.rowCount || result.rows?.length,
                    affectedRows: result.affectedRows || result.changes,
                };
            } else if ('changes' in result) {
                // Expo SQLite run() result format
                return {
                    rows: [],
                    rowCount: 0,
                    affectedRows: result.changes || 0,
                };
            }
        }
        // Fallback: wrap in QueryResult format
        return { rows: result ? [result] : [] };
    };

    if (info.enableForeignKeys) {
        await db.execute(`PRAGMA foreign_keys = ON` as unknown as SQL);
    }
    db.deleteDatabase = async (conn: SqliteMobileConnectionInfo) => {
        // Works only when DB was opened by name
        if (!("name" in conn)) {
            throw new Error("deleteDatabase can only be used when opening by name");
        }

        const fileName = conn.name.endsWith(".db")
            ? info.name
            : `${info.name}.db`;

        const dbPath = `${FileSystem.documentDirectory}SQLite/${fileName}`;

        // 1. Close SQLite connection
        // @ts-ignore
        if (this.connInfo.name === conn.name){
            // @ts-ignore
            this.close();
        }

        // 2. Delete the file
        const fileInfo = await FileSystem.getInfoAsync(dbPath);
        if (fileInfo.exists) {
            await FileSystem.deleteAsync(dbPath, { idempotent: true });
        }
    };

    return db as DrizzleDatabaseConnectionDriver<SqliteMobileConnectionInfo>;
};

export const sqliteDriver: XPDriverImpl = {
    ...driverDetails,
    // @ts-ignore
    connect: connectToSqliteMobile,
}

export default connectToSqliteMobile;