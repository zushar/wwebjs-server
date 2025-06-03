import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from 'src/logging/logging.module';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';
import { ChatService } from './chat.service';
import { ConnectionService } from './connection.service';
import { ChatEntity } from './entityes/chat.entity';
import { MessageEntity } from './entityes/message.entity';
import { MessageService } from './message.service';

@Module({
  imports: [
    LoggingModule,
    TypeOrmModule.forFeature([ChatEntity, MessageEntity]),
  ],
  providers: [BaileysService, ConnectionService, MessageService, ChatService],
  controllers: [BaileysController],
  exports: [BaileysService],
})
export class BaileysModule {}
