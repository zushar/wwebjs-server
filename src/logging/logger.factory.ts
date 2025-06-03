// src/logging/enhanced-logger.factory.ts
import * as fs from 'fs';
import type { WinstonModuleOptions } from 'nest-winston';
import { utilities as nestWinstonUtils } from 'nest-winston';
import * as path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

// Custom format for better readability in files
const readableFormat = winston.format.printf((info) => {
  // Format the main log message
  let formattedMessage = `[${String(info.timestamp)}] ${String(info.level).toUpperCase()}`;

  // Add context if available
  if (info.context && typeof info.context === 'string') {
    formattedMessage += ` [${info.context}]`;
  }

  // Add session if available
  if (info.session && typeof info.session === 'string') {
    formattedMessage += ` [Session: ${info.session}]`;
  }

  // Add the message
  formattedMessage += `: ${String(info.message)}`;

  // Add any additional metadata
  const metaKeys = Object.keys(info).filter(
    (key) =>
      ![
        'level',
        'message',
        'ms',
        'pid',
        'hostname',
        'timestamp',
        'context',
        'session',
      ].includes(key),
  );

  if (metaKeys.length > 0) {
    const metaData = metaKeys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = info[key];
      return acc;
    }, {});
    formattedMessage += `\n${JSON.stringify(metaData, null, 2)}`;
  }

  return formattedMessage;
});

// Format for pretty-printing objects in logs
const prettyPrintObjects = winston.format((info) => {
  if (
    typeof info.message === 'string' &&
    (info.message.includes('{') || info.message.includes('['))
  ) {
    try {
      // Try to parse JSON strings in the message
      const match = info.message.match(/({.*}|\[.*\])/s);
      if (match) {
        const jsonStr = match[0];
        // Type assertion here since we've verified it's valid JSON
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
        const prettyJson = JSON.stringify(parsed, null, 2);
        info.message = info.message.replace(jsonStr, `\n${prettyJson}`);
      }
    } catch {
      // If parsing fails, leave the message as is
    }
  }
  return info;
});

export function createEnhancedWinstonOptions(
  appName = 'WhatsAppAPI',
): WinstonModuleOptions {
  const logDir = path.join(process.cwd(), 'logs');

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return {
    level: 'silly', // Accept all log levels
    exitOnError: false,
    transports: [
      // Console transport with colorization for development
      new winston.transports.Console({
        level: 'silly',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.ms(),
          winston.format.colorize({ all: true }),
          prettyPrintObjects(),
          nestWinstonUtils.format.nestLike(appName, {
            prettyPrint: true,
          }),
        ),
      }),

      // Human-readable log file for all logs
      new winston.transports.DailyRotateFile({
        level: 'silly',
        filename: path.join(logDir, 'readable-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          prettyPrintObjects(),
          readableFormat,
        ),
      }),

      // JSON log file for all logs (machine-readable)
      new winston.transports.DailyRotateFile({
        level: 'silly',
        filename: path.join(logDir, 'json-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),

      // Errors only log file
      new winston.transports.DailyRotateFile({
        level: 'error',
        filename: path.join(logDir, 'errors-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          prettyPrintObjects(),
          readableFormat,
        ),
      }),
    ],
  };
}
