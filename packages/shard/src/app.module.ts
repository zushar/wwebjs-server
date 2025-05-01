// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WwebjsModule } from './wwebjs/wwebjs.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    WwebjsModule,
  ],
})
export class AppModule {}
