// src/logging/whatsapp-logger.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type Pino from 'pino';
import { LoggerUtil } from 'src/utils/logget.util';
import { Logger as WinstonLogger } from 'winston';

@Injectable()
export class WhatsAppLoggerService {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly winstonLogger: WinstonLogger,
  ) {}

  /**
   * Creates a Baileys-compatible logger for a specific WhatsApp session
   */
  createSessionLogger(sessionId: string): Pino.Logger {
    return LoggerUtil.createBaileysLogger(sessionId, this.winstonLogger);
  }

  /**
   * Logs WhatsApp connection events with structured format
   */
  logConnectionEvent(sessionId: string, event: string, data: unknown): void {
    this.winstonLogger.info(`WhatsApp ${event}`, {
      session: sessionId,
      event,
      data,
    });
  }

  /**
   * Logs WhatsApp message events
   */
  logMessageEvent(
    sessionId: string,
    event: string,
    jid: string,
    data: unknown,
  ): void {
    this.winstonLogger.info(`WhatsApp message ${event}`, {
      session: sessionId,
      event,
      jid,
      data,
    });
  }

  /**
   * Logs WhatsApp errors with detailed information
   */
  logError(sessionId: string, error: unknown, context?: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.winstonLogger.error(`WhatsApp error: ${errorMessage}`, {
      session: sessionId,
      context,
      stack,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
  }
}
