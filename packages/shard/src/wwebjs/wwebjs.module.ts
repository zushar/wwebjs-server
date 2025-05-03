//wwebjs.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ConnectService } from './connect.service';
import { WwebjsServices } from './wwebjs.services';

@Module({
  imports: [RedisModule],
  providers: [WwebjsServices, ConnectService, ClientFactoryService],
  exports: [ConnectService, WwebjsServices],
})
export class WwebjsModule {}
