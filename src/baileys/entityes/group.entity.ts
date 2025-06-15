import { GroupParticipant } from '@whiskeysockets/baileys';
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
  chatName: string | null | undefined;

  @Column({ type: 'varchar', length: 255, nullable: true })
  messageParticipant: string | null | undefined;

  @Column({ type: 'boolean', nullable: true })
  archived: boolean | null | undefined;
  @Column({ type: 'jsonb', nullable: true })
  participants?: GroupParticipant[] | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  messageId: string | null | undefined;

  @Column({ type: 'boolean', nullable: true })
  fromMe: boolean | null | undefined;
  @Column({ type: 'jsonb', nullable: true })
  messageTimestamp: number | Long | null | undefined;
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
