import { forwardRef, Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AnyMessageContent } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { ConnectionService } from './connection.service';
import { GroupEntity } from './entityes/group.entity';

// Define message types for better type safety
export type MessageTypes =
  | 'text'
  | 'image'
  | 'document'
  | 'video'
  | 'audio'
  | 'location';

// Interface for message results
export interface MessageResult {
  to: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class MessageService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(GroupEntity)
    private groupeRepository: Repository<GroupEntity>,
    @Inject(forwardRef(() => ConnectionService))
    private connectionService: ConnectionService,
  ) {}

  async sendMessage(
    sessionId: string,
    to: string,
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{ success: boolean; messageId?: string }> {
    const connection = this.connectionService.getConnection(sessionId);
    if (!connection) {
      throw new Error('Session not found');
    }

    if (connection.status !== 'connected') {
      throw new Error('Connection is not ready');
    }

    if (!connection.socket) {
      throw new Error('Socket is not initialized');
    }

    // Format the number to ensure it's valid
    const formattedNumber = to.includes('@s.whatsapp.net')
      ? to
      : `${to.replace(/[^\d]/g, '')}@s.whatsapp.net`;

    let messageContent: AnyMessageContent;

    // Prepare message content based on type
    switch (type) {
      case 'text':
        messageContent = { text: content as string };
        break;
      case 'image':
        if (typeof content === 'string') {
          // If content is a URL or base64 string
          messageContent = {
            image: { url: content },
            caption:
              typeof content === 'object' && 'caption' in content
                ? (content as { caption?: string }).caption || ''
                : '',
          };
        } else {
          // If content is an object with more options
          const imageContent = content as { url?: string; caption?: string };
          messageContent = {
            image: { url: imageContent.url || '' },
            caption: imageContent.caption || '',
          };
        }
        break;
      case 'document':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            document: { url: (content as { url: string }).url },
            fileName:
              (content as { fileName?: string }).fileName || 'document.pdf',
            mimetype:
              (content as { mimetype?: string }).mimetype || 'application/pdf',
          };
        } else {
          messageContent = {
            document: { url: content as string },
            fileName: 'document.pdf',
            mimetype: 'application/pdf',
          };
        }
        break;
      case 'video':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            video: { url: (content as { url: string }).url },
            caption: (content as { caption?: string }).caption || '',
          };
        } else {
          messageContent = {
            video: { url: content as string },
            caption: '',
          };
        }
        break;
      case 'audio':
        if (typeof content === 'object' && 'url' in content) {
          messageContent = {
            audio: { url: (content as { url: string }).url },
            ptt: (content as { ptt?: boolean }).ptt || false,
          };
        } else {
          messageContent = {
            audio: { url: content as string },
            ptt: false,
          };
        }
        break;
      case 'location':
        if (
          typeof content === 'object' &&
          'degreesLatitude' in content &&
          'degreesLongitude' in content
        ) {
          const locationContent = content as {
            degreesLatitude: number;
            degreesLongitude: number;
            name?: string;
          };
          messageContent = {
            location: {
              degreesLatitude: locationContent.degreesLatitude,
              degreesLongitude: locationContent.degreesLongitude,
              name: locationContent.name || '',
            },
          };
        } else {
          throw new Error(
            'Location content must include degreesLatitude and degreesLongitude',
          );
        }
        break;
      default:
        messageContent = {
          text: typeof content === 'string' ? content : JSON.stringify(content),
        };
    }

    try {
      const sentMsg = await connection.socket.sendMessage(
        formattedNumber,
        messageContent,
      );
      return {
        success: true,
        messageId: sentMsg?.key?.id || undefined,
      };
    } catch (error) {
      const errorObj = error as Error;
      this.logger.error(
        `Failed to send message to ${to} from ${sessionId}:`,
        errorObj,
      );
      throw new Error(`Failed to send message: ${errorObj.message}`);
    }
  }

  async sendBulkMessages(
    sessionId: string,
    recipients: string[],
    content: string | object,
    type: MessageTypes = 'text',
  ): Promise<{
    success: boolean;
    results: MessageResult[];
  }> {
    const results: MessageResult[] = [];
    let numGroups = 0;
    for (const recipient of recipients) {
      try {
        await this.sendMessage(sessionId, recipient, content, type);
        results.push({ to: recipient, success: true });
      } catch (error) {
        const errorObj = error as Error;
        results.push({
          to: recipient,
          success: false,
          error: errorObj.message,
        });
      }
      if (numGroups >= 30) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 1000 + 2000),
        );
        numGroups = 0;
      }
      // Add a small delay between messages to avoid rate limiting
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 1000 + 500),
      );
    }

    return {
      success: results.some((r) => r.success),
      results,
    };
  }
}
