/* eslint-disable prettier/prettier */
// src/types/baileys-ws.d.ts
import type { WASocket } from '@whiskeysockets/baileys';
import type WebSocket from 'ws';

declare module '@whiskeysockets/baileys' {
  interface WASocket {
    /** the raw ws under the hood */
    ws: WebSocket;
  }
}

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

  export interface Connection {
    socket: WASocket | null;
    pairingCode: string | null;
    status: string;
    reconnectAttempts: number;
  }

  export interface SessionInfo {
    phoneNumber: string;
    createdAt: string;
    createdBy: string;
  }
}

// This file only declares globals
export { };

