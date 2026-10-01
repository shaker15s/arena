// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('@expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Enable inline requires for code splitting, smaller initial execution overhead,
// and faster startup on both mobile and web platforms.
config.transformer = {
  ...config.transformer,
  inlineRequires: true,
};

// Boosthis (vendor kit, unpacked under lib/) — aliased so the app can import
// it without npm-installable dependencies (the kit ships pnpm-workspace
// manifests: "workspace:*" / "catalog:"), keeping the tamper manifest clean.
// ponytail: two extraNodeModules entries; if the kit ever publishes to a
// registry, drop these and use a normal dependency.
const path = require('path');
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    '@workspace/boosthis-runtime-rn': path.join(__dirname, 'lib', 'boosthis-runtime-rn'),
    'boosthis-checklist': path.join(__dirname, 'lib', 'boosthis-checklist'),
  },
};

module.exports = config;
