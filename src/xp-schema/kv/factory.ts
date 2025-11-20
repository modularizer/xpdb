/**
 * Key-Value Storage Factory
 * 
 * Creates platform-specific key-value storage drivers.
 */

import type { KeyValueStorage } from './types';
import {detectPlatform, PlatformName} from "../platform";

let currentStorage: KeyValueStorage | null = null;
let storageInitializationPromise: Promise<KeyValueStorage> | null = null;

/**
 * Initialize storage early - sets up the KV storage system
 * This should be called as early as possible, ideally on module import
 */
export async function initializeStorage(): Promise<KeyValueStorage> {
  if (currentStorage) {
    return currentStorage;
  }

  if (storageInitializationPromise) {
    return storageInitializationPromise;
  }

  storageInitializationPromise = (async () => {
    const platform = detectPlatform();
    
    if (platform === PlatformName.WEB) {
      const { IndexedDBStorage } = await import('./drivers/indexeddb');
      currentStorage = new IndexedDBStorage();
    } else if (platform === PlatformName.MOBILE) {
      const { AsyncStorageDriver } = await import('./drivers/async-storage');
      currentStorage = new AsyncStorageDriver();
    } else {
      const { FileSystemStorage } = await import('./drivers/file-system');
      currentStorage = new FileSystemStorage();
    }

    return currentStorage;
  })();

  return storageInitializationPromise;
}

/**
 * Get the current storage instance
 * Creates one if it doesn't exist based on platform
 */
export async function getStorage(): Promise<KeyValueStorage> {
  if (currentStorage) {
    return currentStorage;
  }

  return await initializeStorage();
}

/**
 * Set a custom storage instance
 * Useful for testing
 */
export function setStorage(storage: KeyValueStorage): void {
  currentStorage = storage;
}

