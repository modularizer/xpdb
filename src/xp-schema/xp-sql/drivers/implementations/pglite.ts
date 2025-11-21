// Use dynamic import to avoid Metro bundling preloaded packages
// Static imports cause Metro to bundle PGlite with a preloaded package that has wrong size
import {connectFn, DbConnectionInfo, DrizzleDatabaseConnectionDriver, XPDriverImpl, QueryResult} from "../types";

// QueryResultColumn is defined in types.ts but may not be re-exported, define locally
interface QueryResultColumn {
    name: string;
    dataType?: string;
    nullable?: boolean;
}
// Dynamic import - import inside function to prevent Metro from analyzing
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
// Global lock to prevent concurrent PGLite instance creation
let pgliteInstanceLock: Promise<any> = Promise.resolve();
let pgliteInstances: Map<string, any> = new Map();

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

            // PGlite will load its own WASM and data files internally
            // We don't need to pre-load them manually

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
    // Check if we already have an instance for this name
    // Note: We cache the raw pgliteDb, but we need to check if we can reuse it
    // For now, we'll always create a new drizzle wrapper but reuse the underlying pgliteDb
    let existingPgliteDb: any = null;
    if (pgliteInstances.has(name)) {
        existingPgliteDb = pgliteInstances.get(name);
        // Verify the instance is still valid
        if (existingPgliteDb && !existingPgliteDb.closed) {
            console.log(`[pglite] Reusing existing PGLite instance for ${name}`);
            // Still need to create a new drizzle wrapper, but reuse the underlying instance
            const { drizzle } = await import('drizzle-orm/pglite');
            const db = drizzle(existingPgliteDb) as any;
            db.raw = existingPgliteDb;
            db.connInfo = {name, dialectName: 'pg', driverName: 'pglite'};
            // Explicitly set driverDetails properties to ensure they're set
            db.dialectName = driverDetails.dialectName;
            db.driverName = driverDetails.driverName;
            Object.assign(db, driverDetails);
            
            // Re-wrap execute to normalize results
            const originalExecute = db.execute.bind(db);
            db.execute = async (query: any) => {
                try {
                    const result = await originalExecute(query);
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
                    // Error handling (same as below)
                    throw error;
                }
            };
            
            return db;
        } else {
            // Instance was closed, remove it
            pgliteInstances.delete(name);
        }
    }
    
    // Wait for any ongoing instance creation to complete
    await pgliteInstanceLock;
    
    // Check again after waiting (another thread might have created it)
    if (pgliteInstances.has(name)) {
        const existingPgliteDb = pgliteInstances.get(name);
        if (existingPgliteDb && !existingPgliteDb.closed) {
            console.log(`[pglite] Reusing existing PGLite instance for ${name} (after lock)`);
            // Still need to create a new drizzle wrapper, but reuse the underlying instance
            const { drizzle } = await import('drizzle-orm/pglite');
            const db = drizzle(existingPgliteDb) as any;
            db.raw = existingPgliteDb;
            db.connInfo = {name, dialectName: 'pg', driverName: 'pglite'};
            // Explicitly set driverDetails properties to ensure they're set
            db.dialectName = driverDetails.dialectName;
            db.driverName = driverDetails.driverName;
            Object.assign(db, driverDetails);
            
            // Re-wrap execute to normalize results
            const originalExecute = db.execute.bind(db);
            db.execute = async (query: any) => {
                try {
                    const result = await originalExecute(query);
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
                    throw error;
                }
            };
            
            // Verify dialectName is set before returning
            if (!db.dialectName) {
                throw new Error(`Failed to set dialectName on db object. driverDetails: ${JSON.stringify(driverDetails)}`);
            }
            
            return db;
        }
    }
    
    // Create a new promise for this instance creation
    let resolveInstance: (value: any) => void;
    let rejectInstance: (error: any) => void;
    const instancePromise = new Promise<any>((resolve, reject) => {
        resolveInstance = resolve;
        rejectInstance = reject;
    });
    
    // Update the lock
    pgliteInstanceLock = instancePromise.catch(() => {}).then(() => {});
    
    try {
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

    // Create PGlite instance with IndexedDB for persistent storage
    // Metro is configured to serve PGlite's WASM and data files
    let pgliteDb: any;
    try {
        console.log('[pglite] Creating PGlite instance with IndexedDB storage...');
        // Use idb:// prefix for IndexedDB storage (persistent)
        const PGliteCreate = PGlite.create || pgliteModuleCache.PGlite?.create || pgliteModuleCache.default?.create;
        if (PGliteCreate) {
            console.log('[pglite] Using PGlite.create()');
            pgliteDb = await PGliteCreate(`idb://${name}`);
        } else {
            console.log('[pglite] Using PGlite constructor');
            pgliteDb = new PGlite(`idb://${name}`);
            await pgliteDb.waitReady;
        }
        console.log('[pglite] Successfully created PGlite with IndexedDB storage');
            
            // Ensure PGLite instance is fully ready before creating drizzle wrapper
            if (pgliteDb.waitReady) {
                await pgliteDb.waitReady;
            }
    } catch (error: any) {
        console.error('[pglite] Error creating PGlite:', error);
        console.error('[pglite] Error details:', {
            name: error?.name,
            message: error?.message,
            errno: error?.errno,
            stack: error?.stack
        });
        throw error;
    }

    // Dynamic import to prevent Metro from analyzing
    const { drizzle } = await import('drizzle-orm/pglite');
    const db = drizzle(pgliteDb) as any;
    db.raw = pgliteDb;
    db.connInfo = {name, dialectName: 'pg', driverName: 'pglite'};
        // Explicitly set driverDetails properties to ensure they're set
        db.dialectName = driverDetails.dialectName;
        db.driverName = driverDetails.driverName;
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
            
            // Deep dive into error chain to find the actual database error
            // Drizzle/PGlite often wraps the real error, so we need to dig through the chain
            let actualError = error;
            let errorChain: any[] = [error];
            
            // Follow the error chain (error.cause, error.originalError, etc.)
            let current = error;
            let depth = 0;
            const maxDepth = 5; // Prevent infinite loops
            while (current && depth < maxDepth) {
                if (current.cause && current.cause !== current) {
                    errorChain.push(current.cause);
                    current = current.cause;
                    depth++;
                } else if (current.originalError && current.originalError !== current) {
                    errorChain.push(current.originalError);
                    current = current.originalError;
                    depth++;
                } else if (current.error && current.error !== current) {
                    errorChain.push(current.error);
                    current = current.error;
                    depth++;
                } else {
                    break;
                }
            }
            
            // Find the error with the most detail (prefer one with code, detail, or hint)
            for (const err of errorChain) {
                if (err?.code || err?.detail || err?.hint) {
                    actualError = err;
                    break;
                }
            }
            
            // Extract error properties from the actual database error
            const errorMsg = actualError?.message || error?.message || String(error);
            const errorCode = actualError?.code || error?.code;
            const errorDetail = actualError?.detail || error?.detail;
            const errorHint = actualError?.hint || error?.hint;
            const errorName = actualError?.name || error?.name;
            const errorErrno = actualError?.errno || error?.errno;
            
            // Try to extract all enumerable properties from ALL errors in the chain
            const errorProps: string[] = [];
            const processedErrors = new Set();
            
            for (const err of errorChain) {
                if (!err || typeof err !== 'object' || processedErrors.has(err)) continue;
                processedErrors.add(err);
                
                try {
                    // Extract from the error itself
                    for (const key in err) {
                        if (err.hasOwnProperty(key) && key !== 'message' && key !== 'stack' && key !== 'cause' && key !== 'originalError' && key !== 'error') {
                            const value = err[key];
                            if (value !== undefined && value !== null) {
                                const valueStr = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
                                errorProps.push(`${key}: ${valueStr}`);
                            }
                        }
                    }
                    
                    // Also check for common error property patterns
                    if (err.severity) errorProps.push(`severity: ${err.severity}`);
                    if (err.position) errorProps.push(`position: ${err.position}`);
                    if (err.internalPosition) errorProps.push(`internalPosition: ${err.internalPosition}`);
                    if (err.internalQuery) errorProps.push(`internalQuery: ${err.internalQuery}`);
                    if (err.where) errorProps.push(`where: ${err.where}`);
                    if (err.schema) errorProps.push(`schema: ${err.schema}`);
                    if (err.table) errorProps.push(`table: ${err.table}`);
                    if (err.column) errorProps.push(`column: ${err.column}`);
                    if (err.dataType) errorProps.push(`dataType: ${err.dataType}`);
                    if (err.constraint) errorProps.push(`constraint: ${err.constraint}`);
                } catch (e) {
                    // Ignore errors when extracting properties
                }
            }
            
            // Build enhanced error message with clear explanation
            let enhancedMsg = `❌ Database Error (${errorCode || 'Unknown'}): ${errorMsg}\n\n`;
            
            // If the error message is generic ("Failed query:"), indicate we found more details
            if (errorMsg.startsWith('Failed query:') && (errorCode || errorDetail || errorHint)) {
                enhancedMsg += `⚠️  Note: The error message above is generic. Found actual database error details below:\n\n`;
            }
            
            // Add ALL error properties for debugging
            if (errorProps.length > 0) {
                enhancedMsg += `Error Properties:\n${errorProps.join('\n')}\n\n`;
            }
            
            // Show error chain if there are multiple errors
            if (errorChain.length > 1) {
                enhancedMsg += `Error Chain (${errorChain.length} levels):\n`;
                errorChain.forEach((err, idx) => {
                    const msg = err?.message || String(err);
                    const code = err?.code;
                    enhancedMsg += `  ${idx + 1}. ${code ? `[${code}] ` : ''}${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}\n`;
                });
                enhancedMsg += '\n';
            }
            
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
                    // Add all cause properties
                    for (const key in cause) {
                        if (key !== 'detail' && key !== 'hint' && key !== 'code' && cause.hasOwnProperty(key)) {
                            const value = (cause as any)[key];
                            if (value !== undefined && value !== null) {
                                enhancedMsg += `Cause ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}\n`;
                            }
                        }
                    }
                }
            }
            
            // If error message starts with "Failed query:", it's likely from Drizzle's error handling
            // Try to extract more information from the error object
            if (errorMsg.startsWith('Failed query:')) {
                enhancedMsg += `\n⚠️ Note: This error message format suggests it may be coming from Drizzle's query builder.\n`;
                enhancedMsg += `   The actual database error might be hidden. Check error properties above for more details.\n`;
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
    
    // Ensure execute is set before returning
    if (typeof db.execute !== 'function') {
        throw new Error('Failed to wrap db.execute - execute function is missing after wrapping');
    }
    
    // Cache the instance (cache the raw pgliteDb, not the wrapped db)
    pgliteInstances.set(name, pgliteDb);
    
    resolveInstance!(db);
    return db as DrizzleDatabaseConnectionDriver<PgliteConnectionInfo>;
    } catch (error) {
        rejectInstance!(error);
        throw error;
    }
}

export const pgliteDriver: XPDriverImpl = {
    ...driverDetails,
    // @ts-ignore
    connect: connectToPglite,
}
export default connectToPglite;