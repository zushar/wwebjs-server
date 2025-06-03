// src/logging/logging.module.ts
import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { LoggerUtil } from 'src/utils/logget.util';
import { createEnhancedWinstonOptions } from './logger.factory';
import { WhatsAppLoggerService } from './whatsapp-logger.service';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: () => createEnhancedWinstonOptions(),
    }),
  ],
  providers: [WhatsAppLoggerService, LoggerUtil],
  exports: [WinstonModule, WhatsAppLoggerService, LoggerUtil],
})
export class LoggingModule {}
