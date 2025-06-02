import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';
import { ChatData, MessageData } from './chat-data.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChatData, MessageData])],
  providers: [BaileysService],
  controllers: [BaileysController],
  exports: [BaileysService],
})
export class BaileysModule {}
