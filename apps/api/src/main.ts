import { initSentry } from './observability/sentry-bootstrap.js';
// apps/api/src/main.ts
// OTel SDK is started by ./observability/otel-bootstrap.ts via `node --import`.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';
import { shutdownOtel } from './observability/otel.js';

initSentry();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ZodExceptionFilter());
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);

  const shutdown = async (signal: string): Promise<void> => {
    try {
      await app.close();
      await shutdownOtel();
      process.exit(0);
    } catch (err) {
      console.error('Shutdown failed after ' + signal, err);
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

void bootstrap();
