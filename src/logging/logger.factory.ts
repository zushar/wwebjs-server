// src/logging/logger.factory.ts
import type { WinstonModuleOptions } from 'nest-winston';
import { utilities as nestWinstonUtils } from 'nest-winston';
import * as path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

export function createMaximalWinstonOptions(): WinstonModuleOptions {
  const logDir = path.join(process.cwd(), 'logs');

  return {
    // tell Winston to accept all levels down to 'silly'
    level: 'silly',
    exitOnError: false,
    transports: [
      // ─────────────────────────────── Console ───────────────────────────────
      new winston.transports.Console({
        level: 'silly',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.ms(),
          winston.format.colorize({ all: true }),
          // nestLike prints [Context] and handles stack traces nicely
          nestWinstonUtils.format.nestLike('MyApp', {
            prettyPrint: true,
          }),
        ),
      }),

      // ────────────────────────────── All logs file ────────────────────────────
      new winston.transports.DailyRotateFile({
        level: 'silly',
        filename: path.join(logDir, 'all-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),

      // ───────────────────────────── Errors only file ─────────────────────────
      new winston.transports.DailyRotateFile({
        level: 'error',
        filename: path.join(logDir, 'errors-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  };
}
