/**
 * Key-Value Storage
 * 
 * Cross-platform key-value storage system.
 */

export type { KeyValueStorage } from './types';
export { getStorage, setStorage, initializeStorage } from './factory';
export { IndexedDBStorage } from './drivers/indexeddb';
export { AsyncStorageDriver } from './drivers/async-storage';
// FileSystemStorage is NOT exported - it's Node.js-only and loaded dynamically in factory.ts

