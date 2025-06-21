// src/mongoDB/baileys-auth-state.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaileysAuthState } from './baileys-auth-state.schema';

@Injectable()
export class BaileysAuthStateService {
  constructor(
    @InjectModel(BaileysAuthState.name)
    private readonly authStateModel: Model<BaileysAuthState>,
  ) {}

  async get(namespace: string, key: string): Promise<string | null> {
    const doc = await this.authStateModel.findOne({ namespace, key }).exec();
    return doc?.value ?? null; // Always returns string or null
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    await this.authStateModel
      .updateOne({ namespace, key }, { $set: { value } }, { upsert: true })
      .exec();
  }
}
