//wwebjs.module.ts
import { Module } from '@nestjs/common';
import { RedisTestController } from 'src/redis/redis.controller';
import { RedisModule } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ConnectService } from './connect.service';
import { WhatsAppTestController } from './whatsapp.controller';
import { WwebjsServices } from './wwebjs.services';

@Module({
  imports: [RedisModule],
  controllers: [WhatsAppTestController, RedisTestController],
  providers: [WwebjsServices, ConnectService, ClientFactoryService],
})
export class WwebjsModule {}
