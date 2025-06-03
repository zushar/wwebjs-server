import { Inject, Injectable, LoggerService } from '@nestjs/common';
import {
  WINSTON_MODULE_NEST_PROVIDER,
  WINSTON_MODULE_PROVIDER,
} from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';
import { ChatService } from './chat.service';
import { ConnectionService } from './connection.service';
import { MessageService } from './message.service';

@Injectable()
export class BaileysService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly rawWinston: WinstonLogger,
    private readonly connectionService: ConnectionService,
    private readonly messageService: MessageService,
    private readonly chatService: ChatService,
  ) {}

  async onModuleInit() {
    await this.connectionService.restoreSessions();
  }

  async createConnection(
    sessionId: string,
    phoneNumber: string,
    user: string = 'zushar',
  ): Promise<{ status: string }> {
    this.chatService.initializeSessionChatStore(sessionId);

    return this.connectionService.createConnection(
      sessionId,
      phoneNumber,
      user,
    );
  }

  getPairingCode(sessionId: string): { pairingCode: string } {
    return this.connectionService.getPairingCode(sessionId);
  }

  getConnectionStatus(sessionId: string): { status: string } {
    return this.connectionService.getConnectionStatus(sessionId);
  }

  getActiveSessions(): { sessionId: string; status: string }[] {
    return this.connectionService.getActiveSessions();
  }

  async closeConnection(sessionId: string): Promise<{ success: boolean }> {
    return this.connectionService.closeConnection(sessionId);
  }

  async sendMessage(
    sessionId: string,
    to: string,
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{ success: boolean; messageId?: string }> {
    return this.messageService.sendMessage(sessionId, to, content, type);
  }

  async sendBulkMessages(
    sessionId: string,
    recipients: string[],
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{
    success: boolean;
    results: any[];
  }> {
    return this.messageService.sendBulkMessages(
      sessionId,
      recipients,
      content,
      type,
    );
  }

  getChatStoreSnapshot(): Record<string, Record<string, any>> {
    return this.chatService.getChatStoreSnapshot();
  }
}
