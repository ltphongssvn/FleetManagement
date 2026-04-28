// apps/api/src/main.ts
import { startOtel, shutdownOtel } from './observability/otel.js';

// OTel SDK must start before any other instrumentation imports take effect.
startOtel({
  serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'fleet-api',
  serviceVersion: process.env['npm_package_version'] ?? '0.1.0',
  enabled: process.env['OTEL_ENABLED'] === 'true',
  ...(process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] !== undefined
    ? { endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }
    : {}),
});

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ZodExceptionFilter } from './common/zod-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ZodExceptionFilter());
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);

  process.on('SIGTERM', () => {
    void (async () => {
      await app.close();
      await shutdownOtel();
      process.exit(0);
    })();
  });
}

void bootstrap();
