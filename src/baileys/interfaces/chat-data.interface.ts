// source: src/baileys/baileys.services.ts
import Long from 'long';
export interface WChat {
  sessionId?: string;
  chatid?: string;
  chatName?: string | null | undefined;
  groupSize?: number;
  archived?: boolean | null | undefined;
  messageId?: string | null | undefined;
  messageParticipant?: string | null | undefined;
  fromMe?: boolean | null | undefined;
  messageTimestamp?: number | Long | null | undefined;
  messageText?: string | null | undefined;
  asNewMessage?: boolean;
}
