/**
 * Key-Value Storage Types
 * 
 * Generic interface for cross-platform key-value storage.
 */

/**
 * Interface for key-value storage drivers
 */
export interface KeyValueStorage {
  /**
   * Get a value by key
   * @param key - The key to retrieve
   * @returns The value, or undefined if not found
   */
  get<T = any>(key: string): Promise<T | undefined>;

  /**
   * Set a value by key
   * @param key - The key to store
   * @param value - The value to store
   */
  set<T = any>(key: string, value: T): Promise<void>;

  /**
   * Delete a value by key
   * @param key - The key to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Get all keys
   * @returns Array of all keys
   */
  keys(): Promise<string[]>;

  /**
   * Clear all values
   */
  clear(): Promise<void>;
}

