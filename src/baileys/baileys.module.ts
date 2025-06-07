import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from 'src/logging/logging.module';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';
import { ConnectionService } from './connection.service';
import { GroupEntity } from './entityes/group.entity';
import { MessageEntity } from './entityes/message.entity';
import { GroupService } from './group.service';
import { MessageService } from './message.service';

@Module({
  imports: [
    LoggingModule,
    TypeOrmModule.forFeature([GroupEntity, MessageEntity]),
    forwardRef(() => BaileysModule),
  ],
  providers: [BaileysService, ConnectionService, MessageService, GroupService],
  controllers: [BaileysController],
  exports: [BaileysService],
})
export class BaileysModule {}
