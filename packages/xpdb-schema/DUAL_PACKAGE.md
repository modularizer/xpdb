# Dual Package Support (ESM + CommonJS)

This package supports both **ES Modules (ESM)** and **CommonJS (CJS)** formats for maximum compatibility.

## Implementation

The package is built with dual format support:

1. **ESM build** (`dist/*.js`) - Modern ES modules for:
   - React Native (Metro bundler)
   - Modern browsers (native `<script type="module">`)
   - Node.js 18+ with ESM
   - TypeScript projects

2. **CJS build** (`dist/*.cjs`) - CommonJS for:
   - Older Node.js versions
   - Legacy bundlers
   - Tools that require CommonJS

## Build Process

The build process generates both formats:

```bash
npm run build
```

This runs:
1. `build:esm` - Compiles TypeScript to ESM (`.js` files)
2. `build:cjs` - Compiles TypeScript to CJS (temporary `dist-cjs/`)
3. `build:rename-cjs` - Renames CJS files from `.js` to `.cjs` and moves to `dist/`

## Package.json Configuration

```json
{
  "main": "./dist/index.cjs",        // CJS entry (for require)
  "module": "./dist/index.js",       // ESM entry (for import)
  "types": "./dist/index.d.ts",      // TypeScript definitions
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",    // ESM
      "require": "./dist/index.cjs"  // CJS
    }
  }
}
```

## Usage

The package automatically provides the correct format:

```javascript
// ESM (modern)
import { xpschema, table, text } from 'xpdb-schema';

// CommonJS (legacy)
const { xpschema, table, text } = require('xpdb-schema');
```

Both formats share the same TypeScript definitions, so you get full type safety regardless of which format you use.

