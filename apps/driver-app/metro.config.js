// apps/driver-app/metro.config.js
// Sentry Expo Metro config + .js -> .ts/.tsx resolution for NodeNext-style imports.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const config = getSentryExpoConfig(__dirname);
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js') && (moduleName.startsWith('./') || moduleName.startsWith('../'))) {
    const stripped = moduleName.slice(0, -3);
    try {
      return context.resolveRequest(context, stripped, platform);
    } catch {
      // fall through to default
    }
  }
  if (originalResolveRequest) return originalResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
