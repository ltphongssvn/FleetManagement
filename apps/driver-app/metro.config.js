// apps/driver-app/metro.config.js
// Sentry Expo Metro config: emits debug IDs + source maps for release builds.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
module.exports = getSentryExpoConfig(__dirname);
