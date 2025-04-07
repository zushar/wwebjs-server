//wwebjs.module.ts
import { Module } from '@nestjs/common';
import { WhatsAppTestController } from './whatsapp-test.controller';
import { WwebjsServices } from './wwebjs.services';
import { ConnectService } from './connect.service';
import { ClientFactoryService } from './client-factory.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [WhatsAppTestController],
  providers: [WwebjsServices, ConnectService, ClientFactoryService],
})
export class WwebjsModule {}
