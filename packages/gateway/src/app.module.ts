import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { GatewayController } from './gateway.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'SHARD_SERVICE',
        transport: Transport.GRPC,
        options: {
          package: 'wc',
          protoPath: join(__dirname, './proto/whatsapp_shard.proto'),
          url: process.env.SHARD_ADDR || 'localhost:50051',
          // no need to mention grpc or grpc-js here
        },
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [GatewayController],
})
export class AppModule {}
