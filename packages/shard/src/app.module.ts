// packages/shard/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyModule } from './proxy/proxy.module';
import { RedisModule } from './redis/redis.module';
import { ShardController } from './shard.controller';
import { ClientFactoryService } from './wwebjs/client-factory.service';
import { WwebjsModule } from './wwebjs/wwebjs.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    WwebjsModule,
    ProxyModule,
    RedisModule,
  ],
  providers: [ClientFactoryService],
  controllers: [ShardController],
})
export class AppModule {}