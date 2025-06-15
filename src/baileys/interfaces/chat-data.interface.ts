// source: src/baileys/baileys.services.ts
import { GroupParticipant } from '@whiskeysockets/baileys';
import Long from 'long';
export interface WChat {
  sessionId?: string;
  chatid?: string;
  chatName?: string | null | undefined;
  archived?: boolean | null | undefined;
  messageId?: string | null | undefined;
  participants?: GroupParticipant[] | null;
  messageParticipant?: string | null | undefined;
  fromMe?: boolean | null | undefined;
  messageTimestamp?: number | Long | null | undefined;
}
