type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
  function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
    };
    if (context !== undefined) {
      entry.context = context;
    }
    process.stdout.write(JSON.stringify(entry) + "\n");
  }

  return {
    debug: (message, context?) => log("debug", message, context),
    info: (message, context?) => log("info", message, context),
    warn: (message, context?) => log("warn", message, context),
    error: (message, context?) => log("error", message, context),
  };
}
