import { proto, WAMessage } from '@whiskeysockets/baileys';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GroupEntity } from './group.entity';

@Entity('messages')
export class MessageEntity implements Required<WAMessage> {
  key: proto.IMessageKey;
  message: proto.IMessage | null;
  messageTimestamp: number | import('long') | null;
  participant: string | null;
  messageC2STimestamp: number | import('long') | null;
  ignore: boolean | null;
  starred: boolean | null;
  broadcast: boolean | null;
  pushName: string | null;
  mediaCiphertextSha256: Uint8Array<ArrayBufferLike> | null;
  multicast: boolean | null;
  urlText: boolean | null;
  urlNumber: boolean | null;
  messageStubType: proto.WebMessageInfo.StubType | null;
  clearMedia: boolean | null;
  messageStubParameters: string[] | null;
  duration: number | null;
  labels: string[] | null;
  paymentInfo: proto.IPaymentInfo | null;
  finalLiveLocation: proto.Message.ILiveLocationMessage | null;
  quotedPaymentInfo: proto.IPaymentInfo | null;
  ephemeralStartTimestamp: number | import('long') | null;
  ephemeralDuration: number | null;
  ephemeralOffToOn: boolean | null;
  ephemeralOutOfSync: boolean | null;
  bizPrivacyStatus: proto.WebMessageInfo.BizPrivacyStatus | null;
  verifiedBizName: string | null;
  mediaData: proto.IMediaData | null;
  photoChange: proto.IPhotoChange | null;
  userReceipt: proto.IUserReceipt[] | null;
  quotedStickerData: proto.IMediaData | null;
  futureproofData: Uint8Array<ArrayBufferLike> | null;
  statusPsa: proto.IStatusPSA | null;
  pollUpdates: proto.IPollUpdate[] | null;
  pollAdditionalMetadata: proto.IPollAdditionalMetadata | null;
  agentId: string | null;
  statusAlreadyViewed: boolean | null;
  messageSecret: Uint8Array<ArrayBufferLike> | null;
  keepInChat: proto.IKeepInChat | null;
  originalSelfAuthorUserJidString: string | null;
  revokeMessageTimestamp: number | import('long') | null;
  pinInChat: proto.IPinInChat | null;
  premiumMessageInfo: proto.IPremiumMessageInfo | null;
  is1PBizBotMessage: boolean | null;
  isGroupHistoryMessage: boolean | null;
  botMessageInvokerJid: string | null;
  commentMetadata: proto.ICommentMetadata | null;
  eventResponses: proto.IEventResponse[] | null;
  reportingTokenInfo: proto.IReportingTokenInfo | null;
  newsletterServerId: number | import('long') | null;
  eventAdditionalMetadata: proto.IEventAdditionalMetadata | null;
  isMentionedInStatus: boolean | null;
  statusMentions: string[] | null;
  targetMessageId: proto.IMessageKey | null;
  messageAddOns: proto.IMessageAddOn[] | null;
  statusMentionMessageInfo: proto.IStatusMentionMessage | null;
  isSupportAiMessage: boolean | null;
  statusMentionSources: string[] | null;
  supportAiCitations: proto.ICitation[] | null;
  botTargetId: string | null;
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
  @Column({ type: 'int', nullable: true })
  status!: number | null;

  @Column({ type: 'simple-json', nullable: true })
  reactions!: proto.IReaction[] | null;

  @Column({ default: false })
  isDeleted: boolean;

  @Column({ type: 'simple-json', nullable: true })
  rawData?: any; // Full message data for reference

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relationship with ChatEntity
  @ManyToOne(() => GroupEntity)
  @JoinColumn([
    { name: 'sessionId', referencedColumnName: 'sessionId' },
    { name: 'chatId', referencedColumnName: 'id' },
  ])
  chat: GroupEntity;

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
    this.status = message.status ? message.status : null;

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
        key: reaction.key,
        text: reaction.text || '👍',
        senderTimestampMs: reaction.senderTimestampMs,
      }));
    } else {
      this.reactions = null;
    }
  }
}
