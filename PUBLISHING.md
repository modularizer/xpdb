# Publishing Guide

This monorepo contains two separate npm packages that should be published independently.

## Packages

1. **xpdb-schema** - Core schema builder (packages/xpdb-schema)
2. **xpdb-viewer** - UI components for React Native (packages/xpdb-viewer)

## Publishing xpdb-schema

```bash
cd packages/xpdb-schema
npm run build
npm publish
```

## Publishing xpdb-viewer

```bash
cd packages/xpdb-viewer
npm run build
npm publish
```

## Version Management

Each package has its own version number in its `package.json`. Update versions independently:

- For xpdb-schema: Edit `packages/xpdb-schema/package.json`
- For xpdb-viewer: Edit `packages/xpdb-viewer/package.json`

## Pre-publish Checklist

Before publishing each package:

1. ✅ Run `npm run build` to ensure TypeScript compiles
2. ✅ Check that `dist/` contains the expected output
3. ✅ Verify `package.json` has correct version, name, and metadata
4. ✅ Ensure all dependencies and peer dependencies are correct
5. ✅ Test that the package can be imported in a fresh project
6. ✅ Update CHANGELOG if you maintain one

## Workspace Development

When developing locally, you can use npm workspaces:

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Build specific package
npm run build:schema
npm run build:viewer
```

Note: The `xpdb-viewer` package depends on `xpdb-schema`. When publishing, make sure `xpdb-schema` is published first or already available on npm.

