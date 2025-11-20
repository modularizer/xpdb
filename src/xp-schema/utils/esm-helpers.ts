/**
 * ESM Helpers
 * 
 * Utility functions for ES module compatibility, providing CommonJS equivalents
 * like __filename and __dirname that are not available in ES modules.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Get the current file's path (ES module equivalent of __filename)
 * 
 * Usage:
 *   const __filename = getFilename(import.meta.url);
 * 
 * @param url - The import.meta.url from the calling file
 * @returns The absolute file path
 */
export function getFilename(url: string | URL): string {
  return fileURLToPath(url);
}

/**
 * Get the current file's directory (ES module equivalent of __dirname)
 * 
 * Usage:
 *   const __dirname = getDirname(import.meta.url);
 * 
 * @param url - The import.meta.url from the calling file
 * @returns The absolute directory path
 */
export function getDirname(url: string | URL): string {
  return dirname(fileURLToPath(url));
}

/**
 * Convenience function that returns both __filename and __dirname
 * 
 * Usage:
 *   const { __filename, __dirname } = getFileInfo(import.meta.url);
 * 
 * @param url - The import.meta.url from the calling file
 * @returns Object with __filename and __dirname
 */
export function getFileInfo(url: string | URL): { __filename: string; __dirname: string } {
  const __filename = fileURLToPath(url);
  return {
    __filename,
    __dirname: dirname(__filename),
  };
}

