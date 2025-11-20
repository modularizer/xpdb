export {connect, XPDatabaseConnectionPlus, XPDatabaseConnectionPlusWithTables, xpschema, XPSchemaPlus, XPDatabaseTablePlus} from './xp-plus';
export {getRegistryEntries, getRegistryEntry, saveRegistryEntry, saveRegistryEntries, clearRegistry, removeRegistryEnty, createOrRetrieveRegistryEntry} from './registry-storage';
export * from './xp-sql/dialects/implementations/unbound';
// uuid, uuidDefault, uuidPK are exported from unbound.ts (which extends with composed builders)
export {generateUUID} from './xp-sql/utils/misc/uuid';
// Note: getFilename, getDirname, getFileInfo are NOT exported - they're Node.js-only
// Import them directly from './utils/esm-helpers' if needed in Node.js contexts only
export {deleteDatabase} from './utils/delete-database';
export type {DbConnectionInfo} from './xp-sql/drivers/types';