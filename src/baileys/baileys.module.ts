import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from 'src/logging/logging.module';
import { BaileysAuthStateModule } from 'src/mongoDB/baileys-auth-state.module';
import { RedisModule } from 'src/redis/redis.module';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';
import { ConnectionService } from './connection.service';
import { GroupEntity } from './entityes/group.entity';
import { GroupService } from './group.service';
import { MessageService } from './message.service';

@Module({
  imports: [
    LoggingModule,
    TypeOrmModule.forFeature([GroupEntity]),
    forwardRef(() => BaileysModule),
    RedisModule,
    BaileysAuthStateModule, // Assuming this is defined in your MongoDB module
  ],
  providers: [BaileysService, ConnectionService, MessageService, GroupService],
  controllers: [BaileysController],
  exports: [BaileysService],
})
export class BaileysModule {}
