// src/logging/logging.module.ts
import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { createMaximalWinstonOptions } from './logger.factory';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: createMaximalWinstonOptions,
    }),
  ],
  exports: [WinstonModule],
})
export class LoggingModule {}
