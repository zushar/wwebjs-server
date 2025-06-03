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
    metadata: Record<string, unknown>;
    chatId: string; // The unique chat ID (WhatsApp JID)
    messages: proto.IWebMessageInfo[]; // Array of message objects for this chat
  };
  export interface ArchiveChatAction {
  archived: boolean;
  messageRange: Record<string, unknown>;
}

export interface SyncActionValue {
  timestamp: string;
  archiveChatAction?: ArchiveChatAction;
  [key: string]: unknown;
}

export interface SyncActionData {
  index: string;
  value?: SyncActionValue;
  version?: number;
  [key: string]: unknown;
}

export interface SyncAction {
  syncAction?: SyncActionData;
  index?: string[];
  [key: string]: unknown;
}
}

// This file only declares globals
export { };

