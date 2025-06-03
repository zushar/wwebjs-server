// src/logging/logger.util.ts
import type Pino from 'pino';
import { inspect } from 'util';
import { Logger as WinstonLogger } from 'winston';

export class LoggerUtil {
  // static createBaileysLogger(
  //   sessionId: string,
  //   rawWinston: WinstonLogger,
  // ): Pino.Logger {
  //   // Child Winston logger
  //   const childW = rawWinston.child({ session: sessionId });

  //   // JSON replacer for binary data
  //   const binaryReplacer = (_key: string, val: unknown): unknown => {
  //     if (Buffer.isBuffer(val)) {
  //       return `<Buffer: ${val.toString('hex').substring(0, 50)}${val.length > 25 ? '...' : ''}>`;
  //     }
  //     if (ArrayBuffer.isView(val)) {
  //       const buffer = Buffer.from(val as Uint8Array);
  //       return `<ArrayBuffer: ${buffer.toString('hex').substring(0, 50)}${buffer.byteLength > 25 ? '...' : ''}>`;
  //     }
  //     return val;
  //   };

  //   // Format arguments with better readability
  //   const formatArgs = (args: unknown[]): string => {
  //     return args
  //       .map((arg) => {
  //         if (typeof arg === 'string') {
  //           return arg;
  //         }

  //         try {
  //           // For objects, format them nicely
  //           return JSON.stringify(arg, binaryReplacer, 2);
  //         } catch {
  //           // Fallback to util.inspect for complex objects
  //           return inspect(arg, {
  //             depth: 5,
  //             maxArrayLength: 100,
  //             breakLength: 120,
  //             compact: false,
  //             colors: false,
  //           });
  //         }
  //       })
  //       .join(' ');
  //   };

  //   // Build Pino-shaped adapter
  //   const adapter = {
  //     level: childW.level,
  //     silent: true,

  //     trace: (...a: unknown[]) => childW.verbose?.(formatArgs(a)),
  //     debug: (...a: unknown[]) => childW.debug?.(formatArgs(a)),
  //     info: (...a: unknown[]) => childW.info?.(formatArgs(a)),
  //     warn: (...a: unknown[]) => childW.warn?.(formatArgs(a)),
  //     error: (...a: unknown[]) => childW.error?.(formatArgs(a)),
  //     fatal: (...a: unknown[]) => childW.error?.(`FATAL: ${formatArgs(a)}`),

  //     child: () => adapter,
  //   } as unknown as Pino.Logger;

  //   return adapter;
  // }
  static createBaileysLogger(
    sessionId: string,
    rawWinston: WinstonLogger,
  ): Pino.Logger {
    // Build completely silent Pino-shaped adapter
    const silentAdapter = {
      level: 'silent',
      silent: true,

      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},

      child: () => silentAdapter,
    } as unknown as Pino.Logger;

    return silentAdapter;
  }
}
