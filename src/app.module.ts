// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BaileysModule } from './baileys/baileys.module';
import { WwebjsModule } from './wwebjs/wwebjs.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    WwebjsModule,
    BaileysModule,
  ],
})
export class AppModule {}
