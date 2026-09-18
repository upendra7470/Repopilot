import pino from "pino";
import { getEnv } from "../config/env.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_FIELDS = ["password", "token", "secret", "authorization", "cookie"];

function createLogger(): pino.Logger {
  const env = getEnv();

  return pino({
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    redact: {
      paths: SENSITIVE_FIELDS.map((f) => `*.${f}`),
      censor: REDACTED,
    },
    base: {
      env: env.NODE_ENV,
    },
  });
}

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

export function resetLogger(): void {
  _logger = null;
}
