// source: src/baileys/baileys.services.ts
import { proto } from '@whiskeysockets/baileys';
import Long from 'long';
export interface WChat {
  chatid?: string | null;
  chatName?: string | null;
  participant?: proto.IGroupParticipant[] | null;
  archived?: boolean | null;
  isReadOnly?: boolean | null;
  messageId?: string | null;
  fromMe?: boolean | null;
  messageTimestamp?: number | Long | null;
}
