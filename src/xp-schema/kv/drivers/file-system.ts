/**
 * File System Storage Driver
 * 
 * Node.js platform implementation using the file system.
 * Stores data in JSON files in the user's home directory.
 */

import type { KeyValueStorage } from '../types';

const storageDir = '.xp-deeby';
const storageFile = 'kv-storage.json';

export class FileSystemStorage implements KeyValueStorage {
  private storagePath: string | null = null;
  private cache: Map<string, any> | null = null;

  private async getStoragePath(): Promise<string> {
    if (this.storagePath) {
      return this.storagePath;
    }

    const path = await import('path');
    const os = await import('os');
    const fs = await import('fs/promises');

    const dir = path.join(os.homedir(), storageDir);
    this.storagePath = path.join(dir, storageFile);

    // Ensure directory exists
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

    return this.storagePath;
  }

  private async loadCache(): Promise<Map<string, any>> {
    if (this.cache) {
      return this.cache;
    }

    const fs = await import('fs/promises');
    const storagePath = await this.getStoragePath();

    try {
      const data = await fs.readFile(storagePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.cache = new Map(Object.entries(parsed));
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet, start with empty map
        this.cache = new Map();
      } else {
        console.warn('[FileSystemStorage] Error loading cache:', err);
        this.cache = new Map();
      }
    }

    return this.cache!;
  }

  private async saveCache(): Promise<void> {
    if (!this.cache) {
      return;
    }

    const fs = await import('fs/promises');
    const storagePath = await this.getStoragePath();

    const data = Object.fromEntries(this.cache);
    await fs.writeFile(storagePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    try {
      const cache = await this.loadCache();
      return cache.get(key) as T | undefined;
    } catch (error) {
      console.warn('[FileSystemStorage] Error getting key:', key, error);
      return undefined;
    }
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    try {
      const cache = await this.loadCache();
      cache.set(key, value);
      await this.saveCache();
    } catch (error) {
      console.error('[FileSystemStorage] Error setting key:', key, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const cache = await this.loadCache();
      cache.delete(key);
      await this.saveCache();
    } catch (error) {
      console.error('[FileSystemStorage] Error deleting key:', key, error);
      throw error;
    }
  }

  async keys(): Promise<string[]> {
    try {
      const cache = await this.loadCache();
      return Array.from(cache.keys());
    } catch (error) {
      console.warn('[FileSystemStorage] Error getting keys:', error);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      this.cache = new Map();
      await this.saveCache();
    } catch (error) {
      console.error('[FileSystemStorage] Error clearing storage:', error);
      throw error;
    }
  }
}

