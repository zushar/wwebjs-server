import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('session_data')
export class SessionData {
  @PrimaryColumn()
  id!: string; // This would be your clientId

  @Index()
  @Column({ nullable: true })
  phoneNumber!: string;

  @Column({ type: 'json' })
  authState!: Record<string, any>; // Stores Baileys auth credentials

  @Column({ type: 'boolean', default: false })
  isConnected!: boolean;

  @Column({ nullable: true })
  pairingCode?: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  lastActiveAt!: Date;
}
