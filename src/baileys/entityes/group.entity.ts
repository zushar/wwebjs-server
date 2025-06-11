import { proto } from '@whiskeysockets/baileys';
import Long from 'long';
import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WChat } from '../interfaces/chat-data.interface';

@Entity('groups')
@Index(['sessionId', 'chatid'], { unique: true }) // Add composite unique index
export class GroupEntity implements WChat {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  sessionId: string;

  @PrimaryColumn({ type: 'varchar', length: 255 }) // Make this a primary column too
  chatid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  chatName?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  participant?: proto.IGroupParticipant[] | null;

  @Column({ type: 'boolean', default: false })
  archived?: boolean | null;

  @Column({ type: 'boolean', default: false })
  isReadOnly?: boolean | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  messageId?: string | null;

  @Column({ type: 'boolean', default: false })
  fromMe?: boolean | null;
  @Column({ type: 'jsonb', nullable: true })
  messageTimestamp?: number | Long | null;
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
