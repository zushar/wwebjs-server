// src/mongoDB/baileys-auth-state.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class BaileysAuthState extends Document {
  @Prop({ required: true })
  namespace: string;

  @Prop({ required: true })
  key: string;

  @Prop({ type: String, required: true }) // <-- Store as string!
  value: string;
}

export const BaileysAuthStateSchema =
  SchemaFactory.createForClass(BaileysAuthState);
BaileysAuthStateSchema.index({ namespace: 1, key: 1 }, { unique: true });
