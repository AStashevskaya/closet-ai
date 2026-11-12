// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // The icon renderer is a one-off Node script, not app code.
    ignores: ['dist/*', '.expo/*', 'assets/icon-source/*'],
  },
]);
