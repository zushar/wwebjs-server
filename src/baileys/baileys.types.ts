import { WASocket } from '@whiskeysockets/baileys';

// Common types used across the application
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
