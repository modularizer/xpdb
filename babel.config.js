module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Transform import.meta for React Native compatibility
      ['@babel/plugin-syntax-import-meta'],
      // Custom plugin to replace import.meta.url with a valid URL
      function() {
        return {
          visitor: {
            MemberExpression(path) {
              if (
                path.node.object &&
                path.node.object.type === 'MetaProperty' &&
                path.node.object.meta.name === 'import' &&
                path.node.object.property.name === 'meta' &&
                path.node.property.name === 'url'
              ) {
                // Replace import.meta.url with a valid base URL for React Native/web
                // PGlite uses this to resolve relative paths to bundled assets
                // Use the current page origin as the base URL
                path.replaceWithSourceString(
                  '(typeof window !== "undefined" && window.location ? new URL(".", window.location.href).href : "http://localhost/")'
                );
              }
            },
          },
        };
      },
    ],
  };
};

