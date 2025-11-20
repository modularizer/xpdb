# Module System Strategy

## Decision: Write Source in CommonJS, Compile to Both

We write the source code in **CommonJS** format, which gives us:

✅ **Simpler development** - No ESM headaches (`require`, `__filename`, `__dirname` work naturally)  
✅ **Maximum compatibility** - Compiles to both ESM and CJS outputs  
✅ **Cross-platform** - Works everywhere (React Native, browsers, Node.js)

## Build Process

1. **Source Code**: Written in CommonJS (`.ts` files use `require`, `module.exports`, etc.)
2. **CJS Build**: Compiles to `dist/*.cjs` (CommonJS output)
3. **ESM Build**: Compiles to `dist/*.js` (ES Module output)
4. **Both outputs**: Available for consumers to use either format

## Why This Works

- **React Native/Metro**: Handles both ESM and CJS seamlessly
- **Browsers**: Can use the ESM output directly (`<script type="module">`)
- **Node.js**: Can use either format
- **CDNs**: Services like esm.sh, skypack, unpkg automatically serve the right format

## Source Code Style

```typescript
// ✅ This works naturally in CommonJS source
const fs = require('fs');
const path = require('path');
const __filename = __filename; // Available!
const __dirname = __dirname; // Available!

// ✅ Exports work naturally
module.exports = { myFunction };
// or
exports.myFunction = myFunction;
```

TypeScript compiles this to both:
- ESM: `export { myFunction }`
- CJS: `module.exports = { myFunction }`

## Benefits

1. **No `createRequire` hacks** - Just use `require` directly
2. **No `import.meta.url` complexity** - Use `__filename` and `__dirname`
3. **No dual import patterns** - Write once, works everywhere
4. **Simpler examples** - Examples can use CommonJS naturally

## Trade-offs

- Source code uses CommonJS syntax (but TypeScript makes it feel modern)
- Still get ESM output for modern consumers
- Best of both worlds!

