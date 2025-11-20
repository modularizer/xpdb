/**
 * ESM Helpers
 * 
 * Node.js-only utility functions for ES module compatibility.
 * These functions use Node.js built-in modules and will NOT work in React Native or browser.
 * 
 * DO NOT import this file in React Native code - it will cause bundling errors.
 * Only use in Node.js contexts (CLI tools, generation scripts, etc.)
 */

/**
 * Get the current file's path (ES module equivalent of __filename)
 * 
 * Usage:
 *   const __filename = getFilename(import.meta.url);
 * 
 * @param url - The import.meta.url from the calling file
 * @returns The absolute file path
 * @throws Error if called in React Native or browser environments
 */
export function getFilename(url: string | URL): string {
  // Dynamic require - only works in Node.js
  if (typeof require === 'undefined') {
    throw new Error('getFilename is Node.js-only and cannot be used in React Native or browser environments');
  }
  const { fileURLToPath } = require('url');
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
 * @throws Error if called in React Native or browser environments
 */
export function getDirname(url: string | URL): string {
  // Dynamic require - only works in Node.js
  if (typeof require === 'undefined') {
    throw new Error('getDirname is Node.js-only and cannot be used in React Native or browser environments');
  }
  const { fileURLToPath } = require('url');
  const { dirname } = require('path');
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
 * @throws Error if called in React Native or browser environments
 */
export function getFileInfo(url: string | URL): { __filename: string; __dirname: string } {
  // Dynamic require - only works in Node.js
  if (typeof require === 'undefined') {
    throw new Error('getFileInfo is Node.js-only and cannot be used in React Native or browser environments');
  }
  const { fileURLToPath } = require('url');
  const { dirname } = require('path');
  const __filename = fileURLToPath(url);
  return {
    __filename,
    __dirname: dirname(__filename),
  };
}

