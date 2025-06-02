// src/app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BaileysModule } from './baileys/baileys.module';
import { LoggingModule } from './logging/logging.module';
import { RequestLoggerMiddleware } from './logging/request-logger.middleware';
import { WwebjsModule } from './wwebjs/wwebjs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WwebjsModule,
    BaileysModule,
    LoggingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
