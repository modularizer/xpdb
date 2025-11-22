/**
 * Delete Database Utility
 * 
 * Deletes a database using the connection info
 */

import type { DbConnectionInfo } from '../xp-sql/drivers/types';
import { connect } from '../xp-sql/connection';

/**
 * Delete a database using connection info
 * 
 * @param connInfo - Database connection info
 * @returns Promise that resolves when database is deleted
 */
export async function deleteDatabase(connInfo: DbConnectionInfo): Promise<void> {
  // Connect to the database to get access to deleteDatabase method
  const db = await connect(connInfo);
  
  try {
    // Call the driver's deleteDatabase method
    await db.db.deleteDatabase(connInfo);
  } finally {
    // Always close the connection
    await db.db.close();
  }
}




