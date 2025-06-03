import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from 'src/logging/logging.module';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';
import { ChatService } from './chat.service';
import { ConnectionService } from './connection.service';
import { ChatData, MessageData } from './entityes/chat-data.entity';
import { MessageService } from './message.service';

@Module({
  imports: [LoggingModule, TypeOrmModule.forFeature([ChatData, MessageData])],
  providers: [BaileysService, ConnectionService, MessageService, ChatService],
  controllers: [BaileysController],
  exports: [BaileysService],
})
export class BaileysModule {}
