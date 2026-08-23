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
        // It selects VERBOSITY only -- never which code paths load.
        const isProd = config.get<string>('NODE_ENV') === 'production';
        // NO IN-PROCESS TRANSPORT, EVER -- and this cost a red develop to learn.
        //
        // The first version gated pino-pretty on NODE_ENV !== 'production'. The
        // api container runs NODE_ENV=development but installs with
        // `pnpm deploy --prod`, so pino-pretty -- a devDependency -- is absent
        // from the image. pino resolves transport targets at CONSTRUCTION, so
        // the container died at boot with "unable to determine transport target
        // for pino-pretty" before serving a single request; compose bringup
        // failed and the E2E gate on develop went red.
        //
        // THE GATE WAS ON THE WRONG FACT. "Is this a production DEPLOYMENT" and
        // "is this dev DEPENDENCY installed" are different questions, and only
        // the second decides whether a transport can load. Any NODE_ENV-shaped
        // condition carries the same hazard, so re-gating would be the treadmill
        // rather than the fix.
        //
        // Twelve-Factor XI is the actual answer: a process writes its event
        // stream, unbuffered, to stdout and stays OBLIVIOUS TO ROUTING. The same
        // binary then logs to the Docker json-file driver in CI and to the
        // platform collector in production with ZERO code change -- exactly the
        // property an environment branch destroys. Pretty-printing is a
        // local-debugging affordance and a TERMINAL concern: pipe the process
        // through pino-pretty when a human is reading it.
        //
        // Removing the transport also takes the formatter off the hot path,
        // where it is documented to cost 20-30x throughput.
        return {
          pinoHttp: {
            ...nativeLoggerOptions,
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
