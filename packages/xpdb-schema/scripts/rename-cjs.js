#!/usr/bin/env node

/**
 * Rename CJS build files from .js to .cjs and move to dist/
 * This script runs after the CJS build to properly name the files
 */

import { readdir, stat, copyFile, unlink, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

const distCjsDir = join(process.cwd(), 'dist'); // CJS build outputs here
const distEsmDir = join(process.cwd(), 'dist-esm'); // ESM build outputs here
const distDir = join(process.cwd(), 'dist'); // Final output

async function processDirectory(dir, baseDir, destBaseDir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(dir, entry.name);
    const relativePath = sourcePath.replace(baseDir + '/', '');
    const destPath = join(destBaseDir, relativePath);

    if (entry.isDirectory()) {
      // Recursively process subdirectories
      await processDirectory(sourcePath, baseDir, destBaseDir);
    } else if (entry.isFile()) {
      // Ensure destination directory exists
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
      }

      if (entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
        // If from CJS build (dist/), rename .js to .cjs
        // If from ESM build (dist-esm/), keep as .js
        const isFromCjsBuild = !baseDir.includes('dist-esm');
        if (isFromCjsBuild) {
          // This is from CJS build - rename to .cjs
          const cjsPath = destPath.replace(/\.js$/, '.cjs');
          await copyFile(sourcePath, cjsPath);
          console.log(`Renamed ${relativePath} -> ${relativePath.replace(/\.js$/, '.cjs')}`);
        } else {
          // This is from ESM build - keep as .js
          await copyFile(sourcePath, destPath);
        }
      } else {
        // Copy other files (like .d.ts, .map) as-is, but only from CJS build to avoid duplicates
        const isFromCjsBuild = !baseDir.includes('dist-esm');
        if (isFromCjsBuild || !entry.name.endsWith('.d.ts')) {
          await copyFile(sourcePath, destPath);
        }
      }
    }
  }
}

async function renameCjsFiles() {
  if (!existsSync(distEsmDir)) {
    console.log('No dist-esm directory found, ESM build may have failed');
    return;
  }

  // Ensure dist directory exists
  if (!existsSync(distDir)) {
    await mkdir(distDir, { recursive: true });
  }

  // First, copy CJS files (from dist/) and rename .js to .cjs
  if (existsSync(distCjsDir)) {
    await processDirectory(distCjsDir, distCjsDir, distDir);
  }

  // Then, copy ESM files (from dist-esm/) as .js files
  await processDirectory(distEsmDir, distEsmDir, distDir);

  // Clean up temporary dist-esm directory
  if (existsSync(distEsmDir)) {
    await rm(distEsmDir, { recursive: true, force: true });
  }

  console.log('Build files merged successfully');
}

renameCjsFiles().catch((error) => {
  console.error('Error renaming CJS files:', error);
  process.exit(1);
});

