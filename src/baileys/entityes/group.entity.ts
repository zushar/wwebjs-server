import { Chat } from '@whiskeysockets/baileys';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('groups')
export class GroupEntity {
  /**
   * Primary composite key: session ID + chat JID
   */
  @PrimaryColumn()
  sessionId: string;

  @PrimaryColumn()
  @Index()
  id: string; // Chat JID (e.g., "123456789@g.us" for groups, "123456789@s.whatsapp.net" for individuals)

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true, type: 'text' })
  description?: string;

  @Column({ nullable: true })
  pHash?: string; // Profile picture hash

  @Column({ nullable: true, type: 'bigint' })
  conversationTimestamp?: number;

  @Column({ default: 0 })
  unreadCount: number;

  @Column({ default: false })
  archived: boolean; // Changed from 'archive' to 'archived' to match Baileys type

  @Column({ default: false })
  readOnly: boolean;

  @Column({ nullable: true })
  muteEndTime?: number; // Changed from 'mute' to 'muteEndTime'

  @Column({ nullable: true })
  pinned?: number; // Changed from 'pin' to 'pinned'

  @Column({ default: 0 })
  ephemeralExpiration: number; // Disappearing message duration in seconds

  @Column({ nullable: true, type: 'bigint' })
  ephemeralSettingTimestamp?: number;

  @Column({ default: 0 })
  unreadMentionCount: number;

  @Column({ default: false })
  markedAsUnread: boolean;

  @Column({ default: false })
  isGroup: boolean;

  @Column({ default: false })
  isCommunity: boolean;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: {
    owner?: string;
    subject?: string;
    creation?: number;
    participants?: {
      id: string;
      isAdmin: boolean;
      isSuperAdmin: boolean;
    }[];
    announce?: boolean;
    restrict?: boolean;
  };

  @Column({ type: 'simple-json', nullable: true })
  disappearingMode?: {
    initiator?: string;
  };

  @Column({ nullable: true })
  lastMessageId?: string;

  @Column({ nullable: true, type: 'text' })
  lastMessageText?: string;

  @Column({ nullable: true })
  lastMessageTimestamp?: number;

  @Column({ default: false })
  suspended: boolean;

  // System timestamps
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Helper method to update the chat from a Baileys Chat object
   */
  updateFromBaileysGroup(chat: Chat): void {
    this.id = chat.id;

    // Handle name (could be null, which we convert to undefined)
    this.name = chat.name || undefined;

    // Fix conversationTimestamp handling
    this.conversationTimestamp =
      typeof chat.conversationTimestamp === 'number'
        ? chat.conversationTimestamp
        : typeof chat.conversationTimestamp === 'string'
          ? parseInt(chat.conversationTimestamp)
          : typeof chat.conversationTimestamp === 'object' &&
              chat.conversationTimestamp
            ? Number(chat.conversationTimestamp.low || 0)
            : undefined;

    this.unreadCount = chat.unreadCount || 0;
    this.archived = chat.archived || false;
    this.readOnly = chat.readOnly || false;

    this.muteEndTime = undefined; // Update with actual data if available
    this.pinned = undefined; // Update with actual data if available

    this.ephemeralExpiration = chat.ephemeralExpiration || 0;
    this.ephemeralSettingTimestamp = chat.ephemeralSettingTimestamp
      ? typeof chat.ephemeralSettingTimestamp === 'object'
        ? Number(chat.ephemeralSettingTimestamp.low || 0)
        : Number(chat.ephemeralSettingTimestamp)
      : undefined;

    this.unreadMentionCount = chat.unreadMentionCount || 0;
    this.markedAsUnread = chat.markedAsUnread || false;
    this.isGroup = chat.id.endsWith('@g.us');
    this.isCommunity = this.isGroup && chat.commentsCount !== undefined;

    // Handle disappearingMode safely
    if (chat.disappearingMode) {
      this.disappearingMode = {
        initiator:
          typeof chat.disappearingMode === 'object' &&
          'initiator' in chat.disappearingMode
            ? String(chat.disappearingMode.initiator) || undefined
            : undefined,
      };
    } else {
      this.disappearingMode = undefined;
    }

    this.suspended = chat.suspended || false;

    // Extract the most recent message preview if available
    if (Array.isArray(chat.messages) && chat.messages.length > 0) {
      const lastMsgContainer = chat.messages[chat.messages.length - 1];
      if (
        lastMsgContainer &&
        typeof lastMsgContainer === 'object' &&
        'message' in lastMsgContainer
      ) {
        const lastMsg = lastMsgContainer.message;
        if (lastMsg && typeof lastMsg === 'object' && 'key' in lastMsg) {
          this.lastMessageId = lastMsg.key?.id || undefined;

          // Extract basic text preview
          if (lastMsg.message && typeof lastMsg.message === 'object') {
            this.lastMessageText =
              typeof lastMsg.message.conversation === 'string'
                ? lastMsg.message.conversation
                : '(media message)';
          }

          // Fix timestamp handling
          this.lastMessageTimestamp =
            typeof lastMsg.messageTimestamp === 'string'
              ? parseInt(lastMsg.messageTimestamp)
              : typeof lastMsg.messageTimestamp === 'number'
                ? lastMsg.messageTimestamp
                : typeof lastMsg.messageTimestamp === 'object' &&
                    lastMsg.messageTimestamp
                  ? Number(
                      lastMsg.messageTimestamp.low ||
                        lastMsg.messageTimestamp.high ||
                        0,
                    )
                  : undefined;
        }
      }
    }
  }
}
