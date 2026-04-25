// apps/api/src/main.ts
// NestJS bootstrap entrypoint. Starts HTTP server on PORT (default 3000).
// reflect-metadata MUST be the first import for NestJS DI to work.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${String(port)}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
