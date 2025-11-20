/**
 * Cross-platform registry storage
 * 
 * Provides a unified interface for storing database registry entries
 * across different platforms using the generic key-value storage system.
 */

import { getStorage } from './kv';
import {DbConnectionInfo} from "./xp-sql/drivers/types";


const registryKey = 'databases';

/**
 * Get registry entries from storage
 */
export async function getRegistryEntries({driverName, dialectName, name}: {driverName?: string, dialectName?: string, name?: string} = {}): Promise<DbConnectionInfo[]> {
  const storage = await getStorage();
  const entries = (await storage.get<DbConnectionInfo[]>(registryKey)) ?? [];
  return entries.filter((d) => (d.driverName === (driverName ?? d.driverName)) && (dialectName === (dialectName ?? d.dialectName)) && (d.name === (name ?? d.name)))
}

export async function getRegistryEntry(name: string) {
    return (await getRegistryEntries({name}))[0];
}

export async function createOrRetrieveRegistryEntry(entry: DbConnectionInfo): Promise<DbConnectionInfo> {
    const existing = await getRegistryEntry(entry.name);
    if (existing) return existing;
    await saveRegistryEntry(entry);
    // Return the entry we just saved
    return entry;
}


/**
 * Save registry entries to storage
 */
export async function saveRegistryEntries(entries: DbConnectionInfo[]): Promise<void> {
  const storage = await getStorage();
  await storage.set(registryKey, entries);
}

/**
 * Register a database entry
 */
export async function saveRegistryEntry(entry: DbConnectionInfo, overwrite?: boolean): Promise<void> {
    const current = await getRegistryEntries();
    const existing = current.find(e => e.name === entry.name);
    // @ts-ignore
    if (existing && !overwrite && !Object.keys(existing).every(((k) => existing[k] === entry[k]))) {
        throw new Error("Entry already exists and has conflicts")
    }

    const updated = [...current.filter(d => d.name !== entry.name), entry];
    await saveRegistryEntries(updated);

}


export async function removeRegistryEnty(name: string): Promise<void> {
    const current = await getRegistryEntries();
    await saveRegistryEntries(current.filter(d => d.name !== name));
}


export async function clearRegistry(): Promise<void> {
    await saveRegistryEntries([]);
}