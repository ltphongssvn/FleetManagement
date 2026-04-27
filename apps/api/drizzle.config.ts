// apps/api/drizzle.config.ts
// Drizzle Kit config for migrations + schema introspection.
// DATABASE_URL is provided by Fly.io secret in production, .env locally.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/fleet_dev',
  },
  strict: true,
  verbose: true,
});
