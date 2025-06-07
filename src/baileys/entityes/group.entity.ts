import { Chat, proto } from '@whiskeysockets/baileys';
import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * By implementing Required<Chat>, every property in Baileys’ Chat interface
 * (including those originally marked optional, i.e. “type | null”) must appear here—none can be omitted.
 * Required<Chat> forces each optional field to be exactly “type | null” (no undefined).
 *
 * Below, every Chat property is declared exactly as Required<Chat> demands,
 * using `null` to represent “absent.” We also add `sessionId` and `updatedAt`
 * as our own extra columns at the bottom.
 */
@Entity('groups')
export class GroupEntity implements Required<Chat> {
  //
  // ─── 1) ALL Baileys Chat PROPERTIES (no “?”; optional fields use “| null”) ────────
  //

  /**
   * Chat.messages?: proto.IHistorySyncMsg[]
   * → Required<Chat> → messages: proto.IHistorySyncMsg[] | null
   */
  @Column({ type: 'simple-json', nullable: true })
  messages!: proto.IHistorySyncMsg[] | null;

  /**
   * Chat.pinned?: number | Long | null
   * → Required<Chat> → pinned: number | null
   *
   * Baileys gives you a 64-bit Long here, so we store as bigint.
   */
  @Column({ type: 'bigint', nullable: true })
  pinned!: number | null;

  /**
   * Chat.pHash?: string | null
   * → Required<Chat> → pHash: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  pHash!: string | null;

  /**
   * Chat.description?: string | null
   * → Required<Chat> → description: string | null
   */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * Chat.newJid?: string | null
   * → Required<Chat> → newJid: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  newJid!: string | null;

  /**
   * Chat.oldJid?: string | null
   * → Required<Chat> → oldJid: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  oldJid!: string | null;

  /**
   * Chat.id: string
   * Required<Chat> → id: string
   * Baileys always returns a non-null string for Chat.id at runtime.
   */
  @PrimaryColumn()
  @Index()
  id!: string;

  /**
   * Chat.name?: string | null
   * → Required<Chat> → name: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  /**
   * Chat.conversationTimestamp?: number | Long | null
   * → Required<Chat> → conversationTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  conversationTimestamp!: number | Long | null;

  /** Chat.unreadCount: number */
  @Column({ type: 'int', default: 0 })
  unreadCount!: number;

  /** Chat.archived: boolean */
  @Column({ type: 'boolean', default: false })
  archived!: boolean;

  /** Chat.readOnly: boolean */
  @Column({ type: 'boolean', default: false })
  readOnly!: boolean;

  /**
   * Chat.muteEndTime?: number | Long | null
   * → Required<Chat> → muteEndTime: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  muteEndTime!: number | Long | null;

  /**
   * Chat.pin?: number | null
   * → Required<Chat> → pin: number | null
   *
   * This is just a small badge index (never a Long), but you can still store it as bigint if you prefer.
   */
  @Column({ type: 'bigint', nullable: true })
  pin!: number | Long | null;

  /** Chat.ephemeralExpiration: number */
  @Column({ type: 'int', default: 0 })
  ephemeralExpiration!: number;

  /**
   * Chat.ephemeralSettingTimestamp?: number | Long | null
   * → Required<Chat> → ephemeralSettingTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  ephemeralSettingTimestamp!: number | Long | null;

  /** Chat.unreadMentionCount: number */
  @Column({ type: 'int', default: 0 })
  unreadMentionCount!: number;

  /** Chat.markedAsUnread: boolean */
  @Column({ type: 'boolean', default: false })
  markedAsUnread!: boolean;

  /**
   * Chat.endOfHistoryTransfer?: boolean | null
   * → Required<Chat> → endOfHistoryTransfer: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  endOfHistoryTransfer!: boolean | null;

  /**
   * Chat.endOfHistoryTransferType?: proto.Conversation.EndOfHistoryTransferType | null
   * → Required<Chat> → endOfHistoryTransferType: proto.Conversation.EndOfHistoryTransferType | null
   */
  @Column({ type: 'varchar', nullable: true })
  endOfHistoryTransferType!: proto.Conversation.EndOfHistoryTransferType | null;

  /**
   * Chat.notSpam?: boolean | null
   * → Required<Chat> → notSpam: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  notSpam!: boolean | null;

  /**
   * Chat.participant?: proto.IGroupParticipant[] | null
   * → Required<Chat> → participant: proto.IGroupParticipant[] | null
   */
  @Column({ type: 'simple-json', nullable: true })
  participant!: proto.IGroupParticipant[] | null;

  /**
   * Chat.tcToken?: Uint8Array | null
   * → Required<Chat> → tcToken: Uint8Array | null
   */
  @Column({ type: 'simple-array', nullable: true })
  tcToken!: Uint8Array | null;

  /**
   * Chat.tcTokenTimestamp?: number | Long | null
   * → Required<Chat> → tcTokenTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  tcTokenTimestamp!: number | Long | null;

  /**
   * Chat.contactPrimaryIdentityKey?: Uint8Array | null
   * → Required<Chat> → contactPrimaryIdentityKey: Uint8Array | null
   */
  @Column({ type: 'simple-array', nullable: true })
  contactPrimaryIdentityKey!: Uint8Array | null;

  /**
   * Chat.wallpaper?: proto.IWallpaperSettings | null
   * → Required<Chat> → wallpaper: proto.IWallpaperSettings | null
   */
  @Column({ type: 'simple-json', nullable: true })
  wallpaper!: proto.IWallpaperSettings | null;

  /**
   * Chat.mediaVisibility?: proto.MediaVisibility | null
   * → Required<Chat> → mediaVisibility: proto.MediaVisibility | null
   */
  @Column({ type: 'varchar', nullable: true })
  mediaVisibility!: proto.MediaVisibility | null;

  /**
   * Chat.tcTokenSenderTimestamp?: number | Long | null
   * → Required<Chat> → tcTokenSenderTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  tcTokenSenderTimestamp!: number | Long | null;

  /**
   * Chat.suspended?: boolean | null
   * → Required<Chat> → suspended: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  suspended!: boolean | null;

  /**
   * Chat.terminated?: boolean | null
   * → Required<Chat> → terminated: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  terminated!: boolean | null;

  /**
   * Chat.createdAt?: number | Long | null
   * → Required<Chat> → createdAt: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  createdAt!: number | Long | null;

  /**
   * Chat.createdBy?: string | null
   * → Required<Chat> → createdBy: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  /**
   * Chat.support?: boolean | null
   * → Required<Chat> → support: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  support!: boolean | null;

  /**
   * Chat.isParentGroup?: boolean | null
   * → Required<Chat> → isParentGroup: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  isParentGroup!: boolean | null;

  /**
   * Chat.parentGroupId?: string | null
   * → Required<Chat> → parentGroupId: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  parentGroupId!: string | null;

  /**
   * Chat.isDefaultSubgroup?: boolean | null
   * → Required<Chat> → isDefaultSubgroup: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  isDefaultSubgroup!: boolean | null;

  /**
   * Chat.displayName?: string | null
   * → Required<Chat> → displayName: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  /**
   * Chat.pnJid?: string | null
   * → Required<Chat> → pnJid: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  pnJid!: string | null;

  /**
   * Chat.shareOwnPn?: boolean | null
   * → Required<Chat> → shareOwnPn: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  shareOwnPn!: boolean | null;

  /**
   * Chat.pnhDuplicateLidThread?: boolean | null
   * → Required<Chat> → pnhDuplicateLidThread: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  pnhDuplicateLidThread!: boolean | null;

  /**
   * Chat.lidJid?: string | null
   * → Required<Chat> → lidJid: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  lidJid!: string | null;

  /**
   * Chat.username?: string | null
   * → Required<Chat> → username: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  username!: string | null;

  /**
   * Chat.lidOriginType?: string | null
   * → Required<Chat> → lidOriginType: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  lidOriginType!: string | null;

  /**
   * Chat.commentsCount?: number | Long | null
   * → Required<Chat> → commentsCount: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  commentsCount!: number | null;

  /**
   * Chat.locked?: boolean | null
   * → Required<Chat> → locked: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  locked!: boolean | null;

  /**
   * Chat.systemMessageToInsert?: proto.PrivacySystemMessage | null
   * → Required<Chat> → systemMessageToInsert: proto.PrivacySystemMessage | null
   */
  @Column({ type: 'simple-json', nullable: true })
  systemMessageToInsert!: proto.PrivacySystemMessage | null;

  /**
   * Chat.capiCreatedGroup?: boolean | null
   * → Required<Chat> → capiCreatedGroup: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  capiCreatedGroup!: boolean | null;

  /**
   * Chat.accountLid?: string | null
   * → Required<Chat> → accountLid: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  accountLid!: string | null;

  /**
   * Chat.limitSharing?: boolean | null
   * → Required<Chat> → limitSharing: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  limitSharing!: boolean | null;

  /**
   * Chat.limitSharingSettingTimestamp?: number | Long | null
   * → Required<Chat> → limitSharingSettingTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  limitSharingSettingTimestamp!: number | Long | null;

  /**
   * Chat.limitSharingTrigger?: proto.LimitSharing.TriggerType | null
   * → Required<Chat> → limitSharingTrigger: proto.LimitSharing.TriggerType | null
   */
  @Column({ type: 'varchar', nullable: true })
  limitSharingTrigger!: proto.LimitSharing.TriggerType | null;

  /**
   * Chat.limitSharingInitiatedByMe?: boolean | null
   * → Required<Chat> → limitSharingInitiatedByMe: boolean | null
   */
  @Column({ type: 'boolean', nullable: true })
  limitSharingInitiatedByMe!: boolean | null;

  /**
   * Chat.disappearingMode?: proto.IDisappearingMode | null
   * → Required<Chat> → disappearingMode: proto.IDisappearingMode | null
   */
  @Column({ type: 'simple-json', nullable: true })
  disappearingMode!: proto.IDisappearingMode | null;

  /**
   * Chat.lastMsgId?: string | null
   * → Required<Chat> → lastMsgId: string | null
   */
  @Column({ type: 'varchar', nullable: true })
  lastMsgId!: string | null;

  /**
   * Chat.lastMsgText?: string | null
   * → Required<Chat> → lastMsgText: string | null
   */
  @Column({ type: 'text', nullable: true })
  lastMsgText!: string | null;

  /**
   * Chat.lastMsgTimestamp?: number | Long | null
   * → Required<Chat> → lastMsgTimestamp: number | null
   */
  @Column({ type: 'bigint', nullable: true })
  lastMsgTimestamp!: number | Long | null;

  /**
   * Chat.lastMessageRecvTimestamp: number
   * → Required<Chat> → lastMessageRecvTimestamp: number
   * In practice, we store as non-null; if Baileys omits it, we write 0.
   */
  @Column({ type: 'bigint', default: 0 })
  lastMessageRecvTimestamp!: number;

  //
  // ─── 2) USER-DEFINED EXTRA COLUMNS (not part of Chat) ────────────────────────────
  //

  /**
   * Session ID (you combine this with `id` to make a composite primary key).
   */
  @PrimaryColumn()
  sessionId!: string;

  /** Standard “updatedAt” column to track when the row was modified. */
  @UpdateDateColumn()
  updatedAt!: Date;

  //
  // ─── 3) HELPER METHOD FOR COPYING Baileys’ Chat → GroupEntity ─────────────────────
  //

  updateFromBaileysGroup(chat: Chat): void {
    // ─── messages?
    this.messages = chat.messages ?? null;

    // ─── pinned? (BIGINT)
    this.pinned = this.toBigIntOrNull(chat.pinned);

    // ─── pHash?
    this.pHash = chat.pHash ?? null;

    // ─── description?
    this.description = chat.description ?? null;

    // ─── newJid & oldJid
    this.newJid = chat.newJid ?? null;
    this.oldJid = chat.oldJid ?? null;

    // ─── id (string)
    this.id = chat.id!; // Baileys always returns a non-null string

    // ─── name?
    this.name = chat.name ?? null;

    // ─── conversationTimestamp? (BIGINT)
    this.conversationTimestamp = this.toBigIntOrNull(
      chat.conversationTimestamp,
    );

    // ─── unreadCount, archived, readOnly
    this.unreadCount = chat.unreadCount ?? 0;
    this.archived = chat.archived ?? false;
    this.readOnly = chat.readOnly ?? false;

    // ─── muteEndTime? (BIGINT)
    this.muteEndTime = this.toBigIntOrNull(chat.muteEndTime);

    // ─── pin? (BIGINT)
    this.pin = this.toBigIntOrNull((chat as any).pin);

    // ─── ephemeralExpiration (INT)
    this.ephemeralExpiration = chat.ephemeralExpiration ?? 0;

    // ─── ephemeralSettingTimestamp? (BIGINT)
    this.ephemeralSettingTimestamp = this.toBigIntOrNull(
      chat.ephemeralSettingTimestamp,
    );

    // ─── unreadMentionCount & markedAsUnread
    this.unreadMentionCount = chat.unreadMentionCount ?? 0;
    this.markedAsUnread = chat.markedAsUnread ?? false;

    // ─── endOfHistoryTransfer & endOfHistoryTransferType?
    this.endOfHistoryTransfer = chat.endOfHistoryTransfer ?? null;
    this.endOfHistoryTransferType = chat.endOfHistoryTransferType ?? null;

    // ─── notSpam?
    this.notSpam = chat.notSpam ?? null;

    // ─── participant?
    this.participant = Array.isArray(chat.participant)
      ? chat.participant
      : null;

    // ─── tcToken & tcTokenTimestamp? (BIGINT)
    this.tcTokenTimestamp = this.toBigIntOrNull(chat.tcTokenTimestamp);

    // ─── contactPrimaryIdentityKey?
    this.contactPrimaryIdentityKey = chat.contactPrimaryIdentityKey ?? null;

    // ─── wallpaper?
    this.wallpaper = chat.wallpaper ?? null;

    // ─── mediaVisibility?
    this.mediaVisibility = chat.mediaVisibility ?? null;

    // ─── tcTokenSenderTimestamp? (BIGINT)
    this.tcTokenSenderTimestamp = this.toBigIntOrNull(
      chat.tcTokenSenderTimestamp,
    );

    // ─── suspended & terminated?
    this.suspended = chat.suspended ?? null;
    this.terminated = chat.terminated ?? null;

    // ─── createdAt? (BIGINT)
    this.createdAt = this.toBigIntOrNull(chat.createdAt);

    // ─── createdBy?
    this.createdBy = chat.createdBy ?? null;

    // ─── support?
    this.support = chat.support ?? null;

    // ─── isParentGroup / parentGroupId / isDefaultSubgroup?
    this.isParentGroup = chat.isParentGroup ?? null;
    this.parentGroupId = chat.parentGroupId ?? null;
    this.isDefaultSubgroup = chat.isDefaultSubgroup ?? null;

    // ─── displayName / pnJid / shareOwnPn / pnhDuplicateLidThread?
    this.displayName = chat.displayName ?? null;
    this.pnJid = chat.pnJid ?? null;
    this.shareOwnPn = chat.shareOwnPn ?? null;
    this.pnhDuplicateLidThread = chat.pnhDuplicateLidThread ?? null;

    // ─── lidJid / username / lidOriginType?
    this.lidJid = chat.lidJid ?? null;
    this.username = chat.username ?? null;
    this.lidOriginType = chat.lidOriginType ?? null;

    // ─── commentsCount / locked?
    this.commentsCount = chat.commentsCount ?? null;
    this.locked = chat.locked ?? null;

    // ─── systemMessageToInsert?
    this.systemMessageToInsert = chat.systemMessageToInsert ?? null;

    // ─── capiCreatedGroup / accountLid?
    this.capiCreatedGroup = chat.capiCreatedGroup ?? null;
    this.accountLid = chat.accountLid ?? null;

    // ─── limitSharing?
    this.limitSharing = chat.limitSharing ?? null;

    // ─── limitSharingSettingTimestamp? (BIGINT)
    this.limitSharingSettingTimestamp = this.toBigIntOrNull(
      chat.limitSharingSettingTimestamp,
    );

    // ─── limitSharingTrigger?
    this.limitSharingTrigger = chat.limitSharingTrigger ?? null;

    // ─── limitSharingInitiatedByMe?
    this.limitSharingInitiatedByMe = chat.limitSharingInitiatedByMe ?? null;

    // ─── disappearingMode?
    this.disappearingMode = chat.disappearingMode ?? null;

    // ─── lastMsgId / lastMsgText / lastMsgTimestamp? (BIGINT)
    this.lastMsgId =
      (chat as any).lastMsgId === null ? null : (chat as any).lastMsgId;
    this.lastMsgText =
      (chat as any).lastMsgText === null ? null : (chat as any).lastMsgText;

    this.lastMsgTimestamp = this.toBigIntOrNull((chat as any).lastMsgTimestamp);

    // ─── lastMessageRecvTimestamp: number
    // In Baileys, Chat.lastMessageRecvTimestamp is always a number.
    // If somehow undefined, default to 0.
    this.lastMessageRecvTimestamp =
      chat.lastMessageRecvTimestamp === undefined
        ? 0
        : chat.lastMessageRecvTimestamp;
  }

  private toBigIntOrNull(val: any): any {
    if (val === undefined || val === null) return null;
    if (typeof val === 'object' && typeof val.toNumber === 'function')
      return val.toNumber();
    if (typeof val === 'string') return Number(val);
    if (typeof val === 'number') return val;
    return null;
  }
}
