// src/app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaileysModule } from './baileys/baileys.module';
import { GroupEntity } from './baileys/entityes/group.entity';
import { LoggingModule } from './logging/logging.module';
import { RequestLoggerMiddleware } from './logging/request-logger.middleware';
import { BaileysAuthStateModule } from './mongoDB/baileys-auth-state.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres', // or your preferred database
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'whatsapp',
      entities: [GroupEntity],
      synchronize: process.env.NODE_ENV !== 'production', // Auto-create tables in dev
    }),
    MongooseModule.forRoot(
      process.env.MONGO_URI || 'mongodb://root:example@mongo-db:27017/whatsapp',
    ),
    BaileysAuthStateModule,
    BaileysModule,
    LoggingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
