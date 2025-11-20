/**
 * Node.js-only utilities
 * 
 * This file is ONLY used in Node.js environments (CLI tools, code generation, etc.)
 * It should NEVER be imported in React Native code.
 * 
 * Metro is configured to ignore this file entirely.
 */

// These are Node.js built-in modules - only available in Node.js
// Metro will ignore this file, so these requires won't cause issues
export const fs = typeof require !== 'undefined' ? require('fs') : null;
export const path = typeof require !== 'undefined' ? require('path') : null;
export const crypto = typeof require !== 'undefined' ? require('crypto') : null;

// Helper to ensure we're in Node.js
export function requireNodeEnvironment(functionName: string): void {
  if (typeof require === 'undefined') {
    throw new Error(`${functionName} requires Node.js environment`);
  }
}


