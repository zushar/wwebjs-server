// src/mongoDB/baileys-auth-state.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BaileysAuthState,
  BaileysAuthStateSchema,
} from './baileys-auth-state.schema';
import { BaileysAuthStateService } from './baileys-auth-state.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BaileysAuthState.name, schema: BaileysAuthStateSchema },
    ]),
  ],
  providers: [BaileysAuthStateService],
  exports: [BaileysAuthStateService],
})
export class BaileysAuthStateModule {}
