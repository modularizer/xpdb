// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ensure TypeScript files are resolved correctly
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), 'ts', 'tsx', 'wasm'];

// Configure Metro to serve PGlite's WASM and data files
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Serve PGlite WASM and data files from node_modules
      if (req.url.includes('pglite.wasm') || req.url.includes('pglite.data')) {
        const pglitePath = path.join(__dirname, 'node_modules/@electric-sql/pglite/dist');
        let filePath;
        
        if (req.url.includes('pglite.wasm')) {
          filePath = path.join(pglitePath, 'pglite.wasm');
          res.setHeader('Content-Type', 'application/wasm');
        } else if (req.url.includes('pglite.data')) {
          filePath = path.join(pglitePath, 'pglite.data');
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        
        if (filePath && fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          res.setHeader('Content-Length', stat.size);
          return fs.createReadStream(filePath).pipe(res);
        }
      }
      return middleware(req, res, next);
    };
  },
};

// Ignore Node.js-only utility files - they're never imported in React Native
// These files use Node.js-specific features like require() with dynamic paths
// or platform-specific packages that don't exist in React Native
config.resolver.blockList = [
  new RegExp(path.resolve(__dirname, 'src/xp-schema/utils/node-utils.ts').replace(/\\/g, '/')),
  new RegExp(path.resolve(__dirname, 'src/xp-schema/utils/generate-create-script.ts').replace(/\\/g, '/')),
  new RegExp(path.resolve(__dirname, 'src/xp-schema/utils/generate-types.ts').replace(/\\/g, '/')),
  // Postgres driver is Node.js-only and uses platform-specific packages
  // It's only loaded via require() in Node.js contexts, which bypasses Metro's resolver
  new RegExp(path.resolve(__dirname, 'src/xp-schema/xp-sql/drivers/implementations/postgres.ts').replace(/\\/g, '/')),
  // Migration generator uses require() with dynamic paths - Node.js-only
  new RegExp(path.resolve(__dirname, 'src/xp-schema/xp-sql/utils/migrations/migration-generator.ts').replace(/\\/g, '/')),
];

// Configure Metro to serve PGlite's WASM and data files
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Serve PGlite WASM and data files from node_modules
      if (req.url.includes('pglite.wasm') || req.url.includes('pglite.data')) {
        const pglitePath = path.join(__dirname, 'node_modules/@electric-sql/pglite/dist');
        let filePath;
        
        if (req.url.includes('pglite.wasm')) {
          filePath = path.join(pglitePath, 'pglite.wasm');
          res.setHeader('Content-Type', 'application/wasm');
        } else if (req.url.includes('pglite.data')) {
          filePath = path.join(pglitePath, 'pglite.data');
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        
        if (filePath && fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          res.setHeader('Content-Length', stat.size);
          return fs.createReadStream(filePath).pipe(res);
        }
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;

