/**
 * IndexedDB Storage Driver
 * 
 * Web platform implementation using IndexedDB.
 */

import type { KeyValueStorage } from '../types';

export class IndexedDBStorage implements KeyValueStorage {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;
  private version: number;

  constructor(dbName: string = 'xp-deeby-kv', storeName: string = 'kv-store', version: number = 1) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    const indexedDB = typeof window !== 'undefined' ? window.indexedDB : null;
    if (!indexedDB) {
      throw new Error('IndexedDB is not available');
    }

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    try {
      const db = await this.getDB();
      return new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);
        
        request.onsuccess = () => {
          const result = request.result;
          if (result === undefined || result === null) {
            resolve(undefined);
          } else {
            // IndexedDB stores values as-is, so we can return directly
            resolve(result as T);
          }
        };
        
        request.onerror = () => {
          resolve(undefined); // Return undefined on error, don't reject
        };
      });
    } catch (error) {
      console.warn('[IndexedDBStorage] Error getting key:', key, error);
      return undefined;
    }
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);
        
        request.onsuccess = () => {
          resolve();
        };
        
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('[IndexedDBStorage] Error setting key:', key, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);
        
        request.onsuccess = () => {
          resolve();
        };
        
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('[IndexedDBStorage] Error deleting key:', key, error);
      throw error;
    }
  }

  async keys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      return new Promise<string[]>((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAllKeys();
        
        request.onsuccess = () => {
          const keys = request.result as string[];
          resolve(keys);
        };
        
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn('[IndexedDBStorage] Error getting keys:', error);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();
        
        request.onsuccess = () => {
          resolve();
        };
        
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('[IndexedDBStorage] Error clearing storage:', error);
      throw error;
    }
  }
}

