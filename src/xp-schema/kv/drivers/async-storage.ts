/**
 * AsyncStorage Driver
 * 
 * Mobile platform implementation using React Native AsyncStorage.
 */

import type { KeyValueStorage } from '../types';

const prefix = 'xp-deeby-kv-';

export class AsyncStorageDriver implements KeyValueStorage {
  private async getAsyncStorage() {
    const AsyncStorage = await import('@react-native-async-storage/async-storage');
    return AsyncStorage.default;
  }

  private getKey(key: string): string {
    return `${prefix}${key}`;
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    try {
      const AsyncStorage = await this.getAsyncStorage();
      const data = await AsyncStorage.getItem(this.getKey(key));
      if (data === null) {
        return undefined;
      }
      return JSON.parse(data) as T;
    } catch (error) {
      console.warn('[AsyncStorageDriver] Error getting key:', key, error);
      return undefined;
    }
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    try {
      const AsyncStorage = await this.getAsyncStorage();
      await AsyncStorage.setItem(this.getKey(key), JSON.stringify(value));
    } catch (error) {
      console.error('[AsyncStorageDriver] Error setting key:', key, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const AsyncStorage = await this.getAsyncStorage();
      await AsyncStorage.removeItem(this.getKey(key));
    } catch (error) {
      console.error('[AsyncStorageDriver] Error deleting key:', key, error);
      throw error;
    }
  }

  async keys(): Promise<string[]> {
    try {
      const AsyncStorage = await this.getAsyncStorage();
      const allKeys = await AsyncStorage.getAllKeys();
      // Filter keys that start with our prefix and remove the prefix
      return allKeys
        .filter(key => key.startsWith(prefix))
        .map(key => key.substring(prefix.length));
    } catch (error) {
      console.warn('[AsyncStorageDriver] Error getting keys:', error);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const AsyncStorage = await this.getAsyncStorage();
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter(key => key.startsWith(prefix));
      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }
    } catch (error) {
      console.error('[AsyncStorageDriver] Error clearing storage:', error);
      throw error;
    }
  }
}

