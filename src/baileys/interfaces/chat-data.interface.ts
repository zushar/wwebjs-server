// source: src/baileys/baileys.services.ts
import { proto } from '@whiskeysockets/baileys';

// Interface for in-memory chat data storage
export interface InMemoryChatData {
  chatId: string;
  messages: proto.IWebMessageInfo[];
}

// Interface for chat data in database
export interface ChatDataEntity {
  id: string;
  sessionId: string;
  chatId: string;
  metadata: Record<string, any>;
  messageCount: number;
  lastMessageAt: Date;
}

// Interface for message data in database
export interface MessageDataEntity {
  id: string;
  sessionId: string;
  chatId: string;
  fromMe: boolean;
  senderJid?: string;
  messageContent: Record<string, any>;
  timestamp: Date;
}

// Interface for WhatsApp chat
export interface WhatsAppChat {
  id: string;
  name?: string | null;
  unreadCount?: number | null;
  // Use correct property names to match Baileys types
  isGroup?: boolean | null; // We'll handle this property ourselves
  archived?: boolean | null; // This is the correct property name in Baileys
  settings?: {
    isArchived?: boolean;
  };
}
