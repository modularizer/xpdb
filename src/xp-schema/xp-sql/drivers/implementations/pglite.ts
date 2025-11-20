// Use dynamic import to avoid Metro bundling preloaded packages
// Static imports cause Metro to bundle PGlite with a preloaded package that has wrong size
import {connectFn, DbConnectionInfo, DrizzleDatabaseConnectionDriver, XPDriverImpl, QueryResult} from "../types";

// QueryResultColumn is defined in types.ts but may not be re-exported, define locally
interface QueryResultColumn {
    name: string;
    dataType?: string;
    nullable?: boolean;
}
import { drizzle } from "drizzle-orm/pglite";
import {PlatformName} from "../../../platform";


export interface PgliteConnectionInfo extends DbConnectionInfo {
    name: string;
}

const driverDetails = {
    dialectName: 'pg',
    driverName: 'pglite',
    clientPlatforms: {
        [PlatformName.WEB]: true,
        [PlatformName.MOBILE]: false,
        [PlatformName.NODE]: false,
    },
    hostPlatforms: {
        [PlatformName.WEB]: true,
        [PlatformName.MOBILE]: false,
        [PlatformName.NODE]: false,
    },
}

// ============================================================================
// Early PGlite Initialization - Pre-load module, fsBundle, and WASM module
// ============================================================================
// Use dynamic import to avoid Metro bundling preloaded packages

let pgliteModuleCache: any = null;
let fsBundleCache: Response | null | undefined = undefined;
let wasmModuleCache: WebAssembly.Module | null | undefined = undefined;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize PGlite early - loads module, fsBundle, and wasmModule
 * This should be called as early as possible to avoid delays and MIME type issues
 */
async function initializePgliteResources(): Promise<void> {
    if (typeof window === 'undefined') {
        return; // Only initialize in browser environment
    }

    // If already initializing or initialized, return the existing promise
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = (async () => {
        try {
            // 1. Import PGlite module dynamically (avoids Metro bundling preloaded packages)
            if (!pgliteModuleCache) {
                console.log('[pglite] Early initialization: Importing @electric-sql/pglite...');
                pgliteModuleCache = await import('@electric-sql/pglite');
                console.log('[pglite] PGlite module imported, keys:', Object.keys(pgliteModuleCache || {}));
            }

            // 2. Pre-load fsBundle as Response object
            if (fsBundleCache === undefined) {
                try {
                    const response = await fetch('/pglite/pglite.data');
                    if (response.ok) {
                        fsBundleCache = response;
                        console.log('[pglite] Early initialization: fsBundle loaded');
                    } else {
                        fsBundleCache = null; // Mark as attempted but failed
                        console.warn('[pglite] Early initialization: Could not load fsBundle (status:', response.status, ')');
                    }
                } catch (error) {
                    fsBundleCache = null; // Mark as attempted but failed
                    console.warn('[pglite] Early initialization: Error loading fsBundle:', error);
                }
            }

            // 3. Pre-load and compile WASM module
            if (wasmModuleCache === undefined) {
                try {
                    const wasmResponse = await fetch('/pglite/pglite.wasm');
                    if (wasmResponse.ok) {
                        const wasmArrayBuffer = await wasmResponse.arrayBuffer();
                        wasmModuleCache = await WebAssembly.compile(wasmArrayBuffer);
                        console.log('[pglite] Early initialization: WASM module compiled');
                    } else {
                        wasmModuleCache = null; // Mark as attempted but failed
                        console.warn('[pglite] Early initialization: Could not load WASM (status:', wasmResponse.status, ')');
                    }
                } catch (error) {
                    wasmModuleCache = null; // Mark as attempted but failed
                    console.warn('[pglite] Early initialization: Error loading WASM:', error);
                }
            }

            if (!pgliteModuleCache) {
                throw new Error('Failed to import @electric-sql/pglite: module is undefined');
            }
        } catch (error) {
            console.error('[pglite] Early initialization failed:', error);
            throw error;
        }
    })();

    return initializationPromise;
}

// Auto-initialize in browser environment (non-blocking)
if (typeof window !== 'undefined') {
    initializePgliteResources().catch((error) => {
        console.warn('[pglite] Auto-initialization failed (will retry on first use):', error);
    });
}

const connectToPglite: connectFn<PgliteConnectionInfo> = async ({name}: PgliteConnectionInfo)  => {
    // Ensure resources are loaded before creating PGlite instance
    await initializePgliteResources();

    if (!pgliteModuleCache) {
        throw new Error('PGlite module not loaded');
    }

    // Extract PGlite class from dynamically imported module
    let PGlite: any = pgliteModuleCache.PGlite;

    if (!PGlite && 'PGlite' in pgliteModuleCache) {
        console.warn('[pglite] PGlite key exists but value is undefined/null');
        try {
            PGlite = pgliteModuleCache['PGlite'];
        } catch (e) {
            console.error('[pglite] Error accessing PGlite:', e);
        }
    }

    if (!PGlite && pgliteModuleCache.default) {
        if (typeof pgliteModuleCache.default === 'object') {
            PGlite = pgliteModuleCache.default.PGlite;
        } else if (typeof pgliteModuleCache.default === 'function') {
            PGlite = pgliteModuleCache.default;
        }
    }

    if (!PGlite) {
        console.error('[pglite] PGlite module contents:', Object.keys(pgliteModuleCache));
        throw new Error(`Failed to find PGlite in @electric-sql/pglite module. Available exports: ${Object.keys(pgliteModuleCache).join(', ')}`);
    }

    // Use cached fsBundle and wasmModule (loaded during early initialization)
    // This avoids Metro's bundled preloaded package which has wrong size
    // Try with wasmModule first, then add fsBundle if needed
    let pgliteDb: any;
    
    // PGlite expects fsBundle as a Response object (it calls .arrayBuffer() on it internally)
    // We MUST provide fsBundle to avoid Metro's bundled preloaded package with wrong size
    if (wasmModuleCache) {
        try {
            // Fetch fsBundle as Response (PGlite expects Response, not ArrayBuffer)
            const fsBundleResponse = await fetch('/pglite/pglite.data');
            if (!fsBundleResponse.ok) {
                throw new Error(`Failed to fetch fsBundle: ${fsBundleResponse.status}`);
            }
            
            const options: any = {
                wasmModule: wasmModuleCache,
                fsBundle: fsBundleResponse, // PGlite expects Response, it will call .arrayBuffer() internally
            };
            console.log('[pglite] Creating PGlite with wasmModule + fsBundle (Response)');
            console.log('[pglite] Options:', { 
                hasWasmModule: !!options.wasmModule, 
                hasFsBundle: !!options.fsBundle,
                fsBundleType: options.fsBundle?.constructor?.name,
                dataDir: `idb://${name}`
            });
            // Use idb://${name} format (matches old working code pattern)
            // The pglite/ prefix might be causing filesystem issues
            pgliteDb = new PGlite(`idb://${name}`, options);
            console.log('[pglite] PGlite instance created, waiting for ready...');
            await pgliteDb.waitReady;
            console.log('[pglite] Successfully created PGlite');
        } catch (error: any) {
            console.error('[pglite] Error creating PGlite with wasmModule + fsBundle:', error);
            console.error('[pglite] Error details:', {
                name: error?.name,
                message: error?.message,
                errno: error?.errno,
                stack: error?.stack
            });
            throw error; // Don't fall back - we need fsBundle to avoid preloaded package
        }
    } else {
        // Fallback: try with just fsBundle, or use PGlite.create
        try {
            const fsBundleResponse = await fetch('/pglite/pglite.data');
            if (fsBundleResponse.ok) {
                const options: any = {
                    fsBundle: fsBundleResponse,
                };
                console.log('[pglite] Trying PGlite with fsBundle only');
                pgliteDb = new PGlite(`idb://pglite/${name}`, options);
                await pgliteDb.waitReady;
            } else {
                throw new Error(`Failed to fetch fsBundle: ${fsBundleResponse.status}`);
            }
        } catch (error) {
            console.warn('[pglite] Error with fsBundle only, falling back to PGlite.create:', error);
            // Final fallback
            const PGliteCreate = pgliteModuleCache.PGlite?.create || pgliteModuleCache.default?.create;
            if (PGliteCreate) {
                pgliteDb = await PGliteCreate(`idb://pglite/${name}`);
            } else {
                pgliteDb = new PGlite(`idb://pglite/${name}`);
                await pgliteDb.waitReady;
            }
        }
    }

    const db = drizzle(pgliteDb) as any;
    db.raw = pgliteDb;
    db.connInfo = {name, dialectName: 'pg', driverName: 'pglite'};
    Object.assign(db, driverDetails);
    
    // Normalize execute() to return consistent QueryResult format
    // PGlite's execute() returns Results<T> = { rows: Row<T>[], affectedRows?: number, fields: { name: string, dataTypeID: number }[] }
    const originalExecute = db.execute.bind(db);
    db.execute = async (query: any) => {
        try {
            const result = await originalExecute(query);
            // PGlite's Results type: { rows: Row<T>[], affectedRows?: number, fields: { name: string, dataTypeID: number }[] }
            const columns: QueryResultColumn[] = result.fields?.map((field: { name: string; dataTypeID: number }) => ({
                name: field.name,
                dataType: field.dataTypeID?.toString(),
            })) || [];
            
            return {
                rows: result.rows || [],
                columns: columns,
                rowCount: result.rows?.length || 0,
                affectedRows: result.affectedRows,
            } as unknown as QueryResult;
        } catch (error: any) {
            // Extract query details for debugging
            let queryStr = 'unknown';
            let params: any[] = [];
            
            // First, try to get query from error.cause.query (PGlite often puts it there)
            if (error?.cause?.query) {
                queryStr = error.cause.query;
                params = error.cause.params || [];
            } else if (query) {
                if (typeof query === 'string') {
                    queryStr = query;
                } else if (query.sql) {
                    queryStr = query.sql;
                    params = query.params || query.values || [];
                } else if (query.queryChunks) {
                    // Drizzle SQL objects have queryChunks array
                    // Each chunk can be a string, object with value array, or other types
                    queryStr = query.queryChunks.map((c: any) => {
                        if (typeof c === 'string') {
                            return c;
                        } else if (c && typeof c === 'object') {
                            // StringChunk has value property that is string or string[]
                            if (Array.isArray(c.value)) {
                                return c.value.join('');
                            } else if (typeof c.value === 'string') {
                                return c.value;
                            } else if (c.chunks && Array.isArray(c.chunks)) {
                                return c.chunks.join('');
                            }
                        }
                        return String(c);
                    }).join('');
                    params = query.params || query.values || [];
                } else {
                    queryStr = String(query);
                }
            }
            
            // Extract ALL error properties (Drizzle/PGlite may have custom error properties)
            const errorMsg = error?.message || String(error);
            const errorCode = error?.code;
            const errorDetail = error?.detail;
            const errorHint = error?.hint;
            const errorName = error?.name;
            const errorErrno = error?.errno;
            
            // Try to extract all enumerable properties from the error
            const errorProps: string[] = [];
            if (error && typeof error === 'object') {
                try {
                    for (const key in error) {
                        if (error.hasOwnProperty(key) && key !== 'message' && key !== 'stack') {
                            const value = error[key];
                            if (value !== undefined && value !== null) {
                                errorProps.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore errors when extracting properties
                }
            }
            
            // Build enhanced error message with clear explanation
            let enhancedMsg = `❌ Database Error (${errorCode || 'Unknown'}): ${errorMsg}\n\n`;
            
            // Add human-readable explanation for common PostgreSQL errors
            if (errorCode === '42P01') {
                enhancedMsg += `💡 Explanation: The table or relation does not exist.\n`;
                enhancedMsg += `   This usually means:\n`;
                enhancedMsg += `   - A foreign key references a table that hasn't been created yet\n`;
                enhancedMsg += `   - A table is referenced before it exists in the schema\n`;
                enhancedMsg += `   - Check that tables are created in dependency order\n\n`;
            } else if (errorCode === '23505') {
                enhancedMsg += `💡 Explanation: Unique constraint violation - a duplicate key value exists.\n\n`;
            } else if (errorCode === '23503') {
                enhancedMsg += `💡 Explanation: Foreign key constraint violation - referenced row does not exist.\n\n`;
            }
            
            enhancedMsg += `Query:\n${queryStr}\n\n`;
            if (params.length > 0) {
                enhancedMsg += `Parameters: ${params.map(p => typeof p === 'string' ? `'${p}'` : String(p)).join(', ')}\n\n`;
            }
            
            if (errorDetail) enhancedMsg += `Detail: ${errorDetail}\n`;
            if (errorHint) enhancedMsg += `Hint: ${errorHint}\n`;
            if (errorCode) enhancedMsg += `PostgreSQL Error Code: ${errorCode}\n`;
            if (errorName) enhancedMsg += `Error Type: ${errorName}\n`;
            
            // Add cause information if available
            if (error?.cause) {
                const cause = error.cause;
                if (typeof cause === 'object' && cause !== null) {
                    if (cause.detail) enhancedMsg += `Cause Detail: ${cause.detail}\n`;
                    if (cause.hint) enhancedMsg += `Cause Hint: ${cause.hint}\n`;
                    if (cause.code) enhancedMsg += `Cause Code: ${cause.code}\n`;
                }
            }
            
            const enhancedError = new Error(enhancedMsg);
            if (error?.stack) {
                enhancedError.stack = error.stack;
            }
            // Preserve original error properties
            if (errorCode) (enhancedError as any).code = errorCode;
            if (errorDetail) (enhancedError as any).detail = errorDetail;
            if (errorErrno !== undefined) (enhancedError as any).errno = errorErrno;
            
            throw enhancedError;
        }
    };
    
    db.close = () => Promise.resolve();
    db.deleteDatabase = async (conn: PgliteConnectionInfo) => {
        // @ts-ignore
        const name = (conn ?? this.connInfo).name;
        const indexedDB = typeof window !== 'undefined' ? window.indexedDB : null;
        if (!indexedDB) {
            throw new Error('IndexedDB is not available');
        }

        // PGlite stores databases as idb://{name}, which creates IndexedDB DBs with that name
        // Note: We're using idb://${name} format, so IndexedDB name is just the name
        const indexedDbName = name;
        await new Promise<void>((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(indexedDbName);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onblocked = () => {
                // Database is blocked, wait a bit and try again
                setTimeout(() => {
                    const retryRequest = indexedDB.deleteDatabase(indexedDbName);
                    retryRequest.onsuccess = () => resolve();
                    retryRequest.onerror = () => reject(retryRequest.error);
                }, 100);
            };
        });
    }
    return db as DrizzleDatabaseConnectionDriver<PgliteConnectionInfo>;
}

export const pgliteDriver: XPDriverImpl = {
    ...driverDetails,
    // @ts-ignore
    connect: connectToPglite,
}
export default connectToPglite;