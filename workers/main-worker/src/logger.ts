// workers/main-worker/src/logger.ts
// Factor XI (Logs): emit logs as a structured event stream -- one JSON
// object per line to stdout -- so the execution platform can collect,
// parse, index, and route them. The app never owns log files or routing
// (2026 cloud-native best practice: structured JSON to stdout, platform
// owns shipping). Zero-dependency and pure: the write sink is injected so
// it is unit-testable and could later be swapped for a richer transport.
//
// Replaces free-form console.log/console.error in main.ts, which produced
// unparseable text a log aggregator cannot query by field.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export type LogSink = (line: string) => void;

const NEWLINE = String.fromCharCode(10);

const defaultSink: LogSink = (line) => {
  process.stdout.write(line);
};

export function logEvent(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
  sink: LogSink = defaultSink,
): void {
  const record: LogFields = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  sink(JSON.stringify(record) + NEWLINE);
}
