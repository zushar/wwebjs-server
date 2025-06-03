import { proto } from '@whiskeysockets/baileys';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChatEntity } from './chat.entity';

@Entity('messages')
export class MessageEntity {
  @PrimaryColumn()
  sessionId: string;

  @PrimaryColumn()
  chatId: string;

  @PrimaryColumn()
  id: string;

  @Column({ default: false })
  fromMe: boolean;

  @Column({ nullable: true })
  sender?: string;

  @Column({ nullable: true, type: 'text' })
  text?: string;

  @Column({ type: 'simple-json', nullable: true })
  mediaInfo?: {
    type: string;
    mimeType?: string;
    size?: number;
    url?: string;
    caption?: string;
    fileName?: string;
  };

  @Column({ nullable: true })
  timestamp?: number;

  @Column({ nullable: true })
  status?: string;

  @Column({ type: 'simple-json', nullable: true })
  reactions?: { sender: string; emoji: string }[];

  @Column({ default: false })
  isDeleted: boolean;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any; // Full message data for reference

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relationship with ChatEntity
  @ManyToOne(() => ChatEntity)
  @JoinColumn([
    { name: 'sessionId', referencedColumnName: 'sessionId' },
    { name: 'chatId', referencedColumnName: 'id' },
  ])
  chat: ChatEntity;

  /**
   * Helper method to update the message from a Baileys WebMessageInfo object
   */
  updateFromBaileysMessage(message: proto.IWebMessageInfo): void {
    if (!message.key) {
      throw new Error('Message key is required');
    }

    // Set message ID from key
    this.id = message.key.id || `local-${Date.now()}`;

    // Set chat ID from remoteJid
    this.chatId = message.key.remoteJid || '';

    // Set sender info
    this.fromMe = message.key.fromMe || false;
    this.sender = message.key.participant || message.key.remoteJid || '';

    // Set timestamp
    this.timestamp = message.messageTimestamp
      ? typeof message.messageTimestamp === 'number'
        ? message.messageTimestamp
        : Number(message.messageTimestamp)
      : Math.floor(Date.now() / 1000);

    // Extract message status if available
    this.status = message.status ? String(message.status) : undefined;

    // Set deleted status
    this.isDeleted =
      !!message.messageStubType &&
      [
        proto.WebMessageInfo.StubType.REVOKE,
        proto.WebMessageInfo.StubType.CIPHERTEXT,
      ].includes(message.messageStubType);

    // Extract message text content based on message type
    this.extractTextContent(message);

    // Extract media info if present
    this.extractMediaInfo(message);

    // Extract reactions if available
    this.extractReactions(message);

    // Store raw data for reference
    this.rawData = message;
  }

  /**
   * Helper to extract text content from different message types
   */
  private extractTextContent(message: proto.IWebMessageInfo): void {
    if (!message.message) {
      this.text = undefined;
      return;
    }

    const msg = message.message;

    // Try to extract text from various message types
    if (msg.conversation) {
      this.text = msg.conversation;
    } else if (msg.extendedTextMessage?.text) {
      this.text = msg.extendedTextMessage.text;
    } else if (msg.buttonsResponseMessage?.selectedDisplayText) {
      this.text = msg.buttonsResponseMessage.selectedDisplayText;
    } else if (msg.listResponseMessage?.title) {
      this.text = `${msg.listResponseMessage.title}: ${msg.listResponseMessage.singleSelectReply?.selectedRowId || ''}`;
    } else if (msg.templateButtonReplyMessage?.selectedId) {
      this.text = msg.templateButtonReplyMessage.selectedId;
    } else {
      // For media messages, caption can be considered text
      const mediaWithCaption =
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption;

      if (mediaWithCaption) {
        this.text = mediaWithCaption;
      } else {
        // Set generic text based on message type
        if (msg.imageMessage) {
          this.text = '(image message)';
        } else if (msg.videoMessage) {
          this.text = '(video message)';
        } else if (msg.audioMessage) {
          this.text = '(audio message)';
        } else if (msg.stickerMessage) {
          this.text = '(sticker message)';
        } else if (msg.documentMessage) {
          this.text = `(document: ${msg.documentMessage.fileName || 'unnamed'})`;
        } else if (msg.contactMessage) {
          this.text = `(contact: ${msg.contactMessage.displayName || 'unnamed'})`;
        } else if (msg.locationMessage) {
          this.text = `(location: ${msg.locationMessage.name || 'unnamed'})`;
        } else if (msg.liveLocationMessage) {
          this.text = '(live location)';
        } else if (msg.contactsArrayMessage) {
          this.text = '(multiple contacts)';
        } else if (msg.protocolMessage) {
          this.text = '(protocol message)';
        } else if (msg.reactionMessage) {
          this.text = `(reaction: ${msg.reactionMessage.text || '👍'})`;
        } else {
          this.text = '(message)';
        }
      }
    }
  }

  /**
   * Helper to extract media information
   */
  private extractMediaInfo(message: proto.IWebMessageInfo): void {
    if (!message.message) {
      this.mediaInfo = undefined;
      return;
    }

    const msg = message.message;

    if (msg.imageMessage) {
      this.mediaInfo = {
        type: 'image',
        mimeType: msg.imageMessage.mimetype || 'image/jpeg',
        size: msg.imageMessage.fileLength
          ? Number(msg.imageMessage.fileLength)
          : undefined,
        url: msg.imageMessage.url || undefined,
        caption: msg.imageMessage.caption || undefined,
      };
    } else if (msg.videoMessage) {
      this.mediaInfo = {
        type: 'video',
        mimeType: msg.videoMessage.mimetype || 'video/mp4',
        size: msg.videoMessage.fileLength
          ? Number(msg.videoMessage.fileLength)
          : undefined,
        url: msg.videoMessage.url || undefined,
        caption: msg.videoMessage.caption || undefined,
      };
    } else if (msg.audioMessage) {
      this.mediaInfo = {
        type: 'audio',
        mimeType: msg.audioMessage.mimetype || 'audio/mp4',
        size: msg.audioMessage.fileLength
          ? Number(msg.audioMessage.fileLength)
          : undefined,
        url: msg.audioMessage.url || undefined,
      };
    } else if (msg.documentMessage) {
      this.mediaInfo = {
        type: 'document',
        mimeType: msg.documentMessage.mimetype || undefined,
        size: msg.documentMessage.fileLength
          ? Number(msg.documentMessage.fileLength)
          : undefined,
        url: msg.documentMessage.url || undefined,
        fileName: msg.documentMessage.fileName || undefined,
        caption: msg.documentMessage.caption || undefined,
      };
    } else if (msg.stickerMessage) {
      this.mediaInfo = {
        type: 'sticker',
        mimeType: msg.stickerMessage.mimetype || 'image/webp',
        size: msg.stickerMessage.fileLength
          ? Number(msg.stickerMessage.fileLength)
          : undefined,
        url: msg.stickerMessage.url || undefined,
        // Removed caption as it doesn't exist on IStickerMessage
      };
    } else if (msg.locationMessage) {
      this.mediaInfo = {
        type: 'location',
        caption: msg.locationMessage.name || undefined,
      };
    } else {
      this.mediaInfo = undefined;
    }
  }

  /**
   * Helper to extract reactions from message
   */
  private extractReactions(message: proto.IWebMessageInfo): void {
    if (message.reactions && message.reactions.length > 0) {
      this.reactions = message.reactions.map((reaction) => ({
        sender: reaction.key?.participant || reaction.key?.remoteJid || '',
        emoji: reaction.text || '👍',
      }));
    } else {
      this.reactions = undefined;
    }
  }
}
