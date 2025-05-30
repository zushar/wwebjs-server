import { Module } from '@nestjs/common';
import { BaileysController } from './baileys.controller';
import { BaileysService } from './baileys.services';

@Module({
  imports: [],
  controllers: [BaileysController],
  providers: [BaileysService],
})
export class BaileysModule {}
