// source: src/types/baileys-ws.d.ts
/* eslint-disable prettier/prettier */
import type { WASocket, proto } from '@whiskeysockets/baileys';

declare global {
  export type MessageTypes =
    | 'text'
    | 'image'
    | 'document'
    | 'video'
    | 'audio'
    | 'location';

  export interface MessageResult {
    to: string;
    success: boolean;
    error?: string;
  }

  export type Connection = {
    socket: WASocket;
    pairingCode: string | null;
    status: string;
    reconnectAttempts: number;
  };

  export interface SessionInfo {
    phoneNumber: string;
    createdAt: string;
    createdBy: string;
  }

  export type ChatData = {
    chatId: string; // The unique chat ID (WhatsApp JID)
    messages: proto.IWebMessageInfo[]; // Array of message objects for this chat
  };
}

// This file only declares globals
export { };
