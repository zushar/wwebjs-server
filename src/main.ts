// src/main.ts
import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { createEnhancedWinstonOptions } from './logging/logger.factory';

async function bootstrap() {
  // 1) build a single Winston‐in‐Nest logger
  const logger = WinstonModule.createLogger(createEnhancedWinstonOptions());

  // 2) pass it into NestFactory so *all* Nest logs go through it
  const app = await NestFactory.create(AppModule, {
    logger, // replaces Nest's default console logger
  });

  await app.listen(process.env.PORT || 3000);
  logger.log(`🚀 Listening on: ${await app.getUrl()}`, 'Bootstrap');
}

bootstrap().catch(console.error);
