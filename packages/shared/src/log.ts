/** Structured JSON-lines logger. One record per line on stdout. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly service: string;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  pretty?: boolean;
  fields?: LogFields;
  sink?: (line: string) => void;
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  return fallback;
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause ? { cause: err.cause } : {}),
    };
  }
  return err;
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? 'info';
  const threshold = ORDER[level];
  const pretty = options.pretty ?? false;
  const base = options.fields ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (entryLevel: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[entryLevel] < threshold) return;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: entryLevel,
      service: options.service,
      msg,
      ...base,
      ...fields,
    };
    if (record.err !== undefined) record.err = serializeError(record.err);
    if (pretty) {
      const { ts, level: lvl, service, msg: m, ...rest } = record;
      const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      sink(
        `${String(ts).slice(11, 23)} ${String(lvl).toUpperCase().padEnd(5)} [${service}] ${m}${tail}`,
      );
      return;
    }
    sink(JSON.stringify(record));
  };

  return {
    service: options.service,
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) => createLogger({ ...options, fields: { ...base, ...fields }, level, pretty }),
  };
}
