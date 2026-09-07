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

module.exports = config;
