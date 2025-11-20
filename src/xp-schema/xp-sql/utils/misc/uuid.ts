/**
 * UUID generation utilities
 * Uses 16 hex characters (64 bits) for local uniqueness
 * Global uniqueness is handled by the merge table mapping (foreignStorageId + foreignEntityUuid) -> localEntityUuid
 */

/**
 * Generate a new UUID (16 hex characters)
 * With 64 bits of randomness, collision probability is extremely low (1 in 18+ quintillion)
 * No uniqueness checking needed
 */
export function generateUUID(length: number = 16): string {
  // Generate 16 hex characters (64 bits = 18,446,744,073,709,551,616 possible values)
  // Use crypto.getRandomValues for better randomness
    const x = Math.ceil(length / 2);
  const array = new Uint8Array(x);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for environments without crypto.getRandomValues
    for (let i = 0; i < x; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  
  // Convert to 16 hex characters
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').slice(0, length);
}


