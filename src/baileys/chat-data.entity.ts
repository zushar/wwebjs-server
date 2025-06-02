import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  ChatDataEntity,
  MessageDataEntity,
} from './interfaces/chat-data.interface';

@Entity('chat_data')
export class ChatData implements ChatDataEntity {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column()
  sessionId!: string;

  @Index()
  @Column()
  chatId!: string;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, any>;

  @Column({ default: 0 })
  messageCount!: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastMessageAt!: Date;
}

@Entity('message_data')
export class MessageData implements MessageDataEntity {
  @PrimaryColumn()
  id!: string;

  @Index()
  @Column()
  sessionId!: string;

  @Index()
  @Column()
  chatId!: string;

  @Column({ type: 'boolean', default: false })
  fromMe!: boolean;

  @Column({ nullable: true })
  senderJid?: string;

  @Column({ type: 'json' })
  messageContent!: Record<string, any>;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp!: Date;
}
