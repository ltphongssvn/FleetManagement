// apps/api/src/observability/logging.module.ts
// Structured JSON logging for the api (pino), replacing Nest's default string
// logger process-wide.
//
// WHY. The default @nestjs/common Logger writes human-readable STRINGS --
// "[Nest] 28705 - 03/31/2026, 12:21:49 PM DEBUG [PgService] connected". Fine on
// a laptop, unqueryable in production: you cannot filter by request id,
// correlate a 500 spike to one service, or index a field, because there are no
// fields. 2026 log stores index JSON; unstructured lines pay full-text indexing
// and break correlation with traces.
//
// pino specifically: valid JSON with no external schema, ~650k ops/sec for 1KB
// messages on Node 22 (3-6x bunyan, 7-8x winston in JSON mode), and asynchronous,
// so a log line never blocks the event loop the way console.log does.
//
// NativeLogger, NOT Logger -- the one choice here that is easy to get wrong.
// nestjs-pino exports both. `Logger` treats extra arguments as pino-style
// interpolation (logger.log('foo %s', 'bar') -> one message); `NativeLogger`
// keeps NestJS semantics, where each argument is its own entry. THIRTEEN files
// in apps/api already call `new Logger(Ctx.name)` the NestJS way, so picking
// `Logger` would silently change the output of every one of them. NativeLogger
// keeps message, context, level, timestamp, pid and stack identical while adding
// pino's throughput and automatic request-context binding -- so this migration
// changes the SINK, not any call site.
//
// TRACE CORRELATION IS AUTOMATIC. otel-bootstrap.ts already starts the OTel SDK
// via `node --import`, and @opentelemetry/instrumentation-pino injects
// trace_id/span_id into every line, so a log and the span that produced it join
// up with no custom formatter.
//
// REDACTION IS CONFIGURATION, NOT DISCIPLINE. This api handles driver passwords,
// passkey challenges, JWTs and the EAS webhook signature. pino redacts at
// serialization time, so a secret that reaches a log line is masked rather than
// shipped. Relying on every developer to remember not to log secrets is the
// thing that fails; a declared path list removes the category.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { LoggerModule, nativeLoggerOptions } from 'nestjs-pino';

/** Paths whose values must never reach a log sink. Frozen and exported so
 *  logging-redaction.guard.test.ts asserts the set rather than trusting memory. */
export const REDACTED_PATHS = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["expo-signature"]',
  'req.body.password',
  'req.body.newPassword',
  'res.headers["set-cookie"]',
] as const);

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // NODE_ENV via the validated ConfigService boundary, never raw process.env.
        const isProd = config.get<string>('NODE_ENV') === 'production';
        // pino-pretty runs the formatter in-process and costs real throughput,
        // so it is DEV ONLY. Production emits newline-delimited JSON straight to
        // stdout for the platform to ingest.
        //
        // CONDITIONAL SPREAD, not `transport: isProd ? undefined : {...}`.
        // exactOptionalPropertyTypes redefines `?:` from "absent or undefined"
        // to "absent, but never explicitly undefined", so the ternary does not
        // typecheck. TypeScript declined a dedicated syntax for this case
        // (microsoft/TypeScript#45606), leaving spread as the sanctioned way to
        // OMIT a key rather than nullify it -- which is also what "no transport"
        // actually means to pino.
        const transport = isProd
          ? {}
          : { transport: { target: 'pino-pretty', options: { singleLine: true } } };
        return {
          pinoHttp: {
            ...nativeLoggerOptions,
            ...transport,
            level: isProd ? 'info' : 'debug',
            redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
            // Railway probes /health every few seconds. Those lines carry no
            // information and would dominate the volume.
            autoLogging: {
              // req is a real node IncomingMessage, not a structural stand-in.
              // Hand-writing `{ url?: string }` fails under
              // exactOptionalPropertyTypes because IncomingMessage.url is
              // `string | undefined`, which an optional-but-not-undefined
              // property cannot accept -- the compiler caught the approximation.
              ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/health'),
            },
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
