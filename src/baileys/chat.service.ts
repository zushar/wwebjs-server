import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { proto } from '@whiskeysockets/baileys';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { ChatData } from './entityes/chat-data.entity';
import {
  InMemoryChatData,
  WhatsAppChat,
} from './interfaces/chat-data.interface';

@Injectable()
export class ChatService {
  private chatStore = new Map<string, Map<string, InMemoryChatData>>();

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectRepository(ChatData)
    private chatRepository: Repository<ChatData>,
  ) {}

  initializeSessionChatStore(sessionId: string): void {
    if (!this.chatStore.has(sessionId)) {
      this.chatStore.set(sessionId, new Map<string, InMemoryChatData>());
    }
  }

  storeChatMessage(sessionId: string, message: proto.IWebMessageInfo): void {
    const chatId = message.key?.remoteJid ?? 'unknown';
    if (!this.chatStore.has(sessionId)) {
      this.chatStore.set(sessionId, new Map<string, InMemoryChatData>());
    }
    const sessionChats = this.chatStore.get(sessionId)!;
    if (!sessionChats.has(chatId)) {
      sessionChats.set(chatId, {
        chatId,
        messages: [],
      });
    }
    const chatData = sessionChats.get(chatId)!;
    chatData.messages.push(message);
  }

  async storeChat(sessionId: string, chat: WhatsAppChat): Promise<void> {
    const chatId = `${sessionId}-${chat.id}`;

    try {
      // Create the entity with type safety
      const chatEntity = new ChatData();
      chatEntity.id = chatId;
      chatEntity.sessionId = sessionId;
      chatEntity.chatId = chat.id;

      // Type-safe group detection - either use the provided property or infer from ID
      const isGroup =
        typeof chat.isGroup === 'boolean'
          ? chat.isGroup
          : chat.id.endsWith('@g.us');

      // Type-safe archive detection using the correct property name
      let isArchived = false;

      // First check the standard property from Baileys
      if (typeof chat.archived === 'boolean') {
        isArchived = chat.archived;
      }
      // Check for settings container if available
      else if (
        chat.settings &&
        typeof chat.settings === 'object' &&
        chat.settings !== null &&
        typeof chat.settings.isArchived === 'boolean'
      ) {
        isArchived = chat.settings.isArchived;
      }

      chatEntity.metadata = {
        name: chat.name || '',
        unreadCount: chat.unreadCount ?? 0,
        isGroup,
        isArchived,
      };
      chatEntity.lastMessageAt = new Date();

      // Type-safe debug logging
      const debugInfo = {
        chatId,
        archived:
          typeof chat.archived === 'boolean' ? chat.archived : 'not set',
        settingsArchived: chat.settings?.isArchived,
        rawId: chat.id,
      };

      this.logger.log(
        `Chat ${chatId} archive properties: ${JSON.stringify(debugInfo)}`,
        'ChatService',
      );

      // Check if entity exists first
      const exists = await this.chatRepository.findOne({
        where: { id: chatId },
      });

      if (exists) {
        // Update existing entity
        await this.chatRepository.update(
          { id: chatId },
          {
            metadata: chatEntity.metadata,
            lastMessageAt: chatEntity.lastMessageAt,
          },
        );
      } else {
        // Create new entity
        await this.chatRepository.save(chatEntity);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to store chat ${chatId}:`, err);
    }
  }

  async updateChatArchiveStatus(
    sessionId: string,
    chatId: string,
    isArchived: boolean,
  ): Promise<void> {
    try {
      const fullChatId = `${sessionId}-${chatId}`;
      const existingChat = await this.chatRepository.findOne({
        where: { id: fullChatId },
      });

      if (existingChat) {
        // Properly type the metadata object
        const metadata = existingChat.metadata as Record<string, unknown>;

        // Create a new properly typed metadata object
        const updatedMetadata = {
          ...metadata,
          isArchived,
        };

        // Update the entity
        existingChat.metadata = updatedMetadata;

        // Use save instead of update to handle complex object types
        await this.chatRepository.save(existingChat);

        this.logger.log(
          `Updated archive status for ${chatId} to ${isArchived}`,
          'ChatService',
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to update archive status for ${chatId}`, err);
    }
  }

  getChatStoreSnapshot(): Record<string, Record<string, any>> {
    const snapshot: Record<string, Record<string, any>> = {};
    for (const [sessionId, chats] of this.chatStore.entries()) {
      snapshot[sessionId] = {};
      for (const [chatId, chatData] of chats.entries()) {
        snapshot[sessionId][chatId] = {
          chatId: chatData.chatId,
          messageCount: chatData.messages.length,
        };
      }
    }
    return snapshot;
  }
  /**
   * Updates group participants in the database
   */
  async updateGroupParticipants(
    sessionId: string,
    groupId: string,
    participants: string[],
    action: 'add' | 'remove' | 'promote' | 'demote' | 'modify',
  ): Promise<void> {
    try {
      // Get the combined ID format you're using
      const fullChatId = `${sessionId}-${groupId}`;

      // Find the existing chat
      const existingChat = await this.chatRepository.findOne({
        where: { id: fullChatId },
      });

      if (!existingChat) {
        this.logger.warn(
          `Group ${groupId} not found for participant update in session ${sessionId}`,
          'ChatService',
        );
        return;
      }

      // Get metadata to safely modify it
      const metadata = existingChat.metadata;

      // Initialize participants array if it doesn't exist
      if (!metadata.participants) {
        metadata.participants = [];
      }

      // Update based on action
      switch (action) {
        case 'add':
          for (const jid of participants) {
            if (!metadata.participants.some((p: any) => p.id === jid)) {
              metadata.participants.push({
                id: jid,
                isAdmin: false,
                addedAt: new Date().toISOString(),
              });
            }
          }
          break;
        case 'remove':
          metadata.participants = metadata.participants.filter(
            (p: any) => !participants.includes(p.id),
          );
          break;
        case 'promote':
        case 'demote':
          for (const jid of participants) {
            const participant = metadata.participants.find(
              (p: any) => p.id === jid,
            );
            if (participant) {
              participant.isAdmin = action === 'promote';
              participant.lastStatusChange = new Date().toISOString();
            }
          }
          break;
        case 'modify':
          // Handle modify action - typically this involves updating participant attributes
          for (const jid of participants) {
            const participant = metadata.participants.find(
              (p: any) => p.id === jid,
            );
            if (participant) {
              participant.lastModified = new Date().toISOString();
              // You might need to handle specific modifications if Baileys provides them
            }
          }
      }

      // Update metadata and save
      existingChat.metadata = metadata;
      await this.chatRepository.save(existingChat);

      this.logger.log(
        `Updated ${participants.length} participants for group ${groupId} in session ${sessionId}: ${action}`,
        'ChatService',
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update participants for group ${groupId} in session ${sessionId}:`,
        err,
      );
    }
  }

  /**
   * Updates contact information in the database
   * Note: This is a placeholder implementation. You should create a ContactData entity
   * and repository for a proper implementation.
   */
  updateContact(sessionId: string, contactUpdate: any): void {
    try {
      this.logger.log(
        `Contact update for ${contactUpdate.id} in session ${sessionId}`,
        'ChatService',
      );

      // This is where you would update the contact in your database
      // Since you don't have a Contact entity/repository yet, this is a placeholder

      // Implementation recommendation:
      // 1. Create a ContactData entity (see definition above)
      // 2. Add a repository injection to this service:
      //    @InjectRepository(ContactData) private contactRepository: Repository<ContactData>
      // 3. Implement the update logic similar to:
      /*
    const contactId = `${sessionId}-${contactUpdate.id}`;
    const existingContact = await this.contactRepository.findOne({
      where: { id: contactId },
    });
    
    if (existingContact) {
      // Update existing contact
      existingContact.name = contactUpdate.name || existingContact.name;
      existingContact.pushName = contactUpdate.notify || existingContact.pushName;
      existingContact.updatedAt = new Date();
      
      if (contactUpdate.imgUrl) {
        existingContact.metadata = {
          ...existingContact.metadata,
          imgUrl: contactUpdate.imgUrl
        };
      }
      
      await this.contactRepository.save(existingContact);
    }
    */
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to update contact ${contactUpdate.id} in session ${sessionId}:`,
        err,
      );
    }
  }

  /**
   * Stores a new contact in the database
   * Note: This is a placeholder implementation. You should create a ContactData entity
   * and repository for a proper implementation.
   */
  storeContact(sessionId: string, contact: any): void {
    try {
      this.logger.log(
        `Storing contact ${contact.id} in session ${sessionId}`,
        'ChatService',
      );

      // This is where you would store the contact in your database
      // Since you don't have a Contact entity/repository yet, this is a placeholder

      // Implementation recommendation:
      // 1. Create a ContactData entity (see definition above)
      // 2. Add a repository injection to this service:
      //    @InjectRepository(ContactData) private contactRepository: Repository<ContactData>
      // 3. Implement the storage logic similar to:
      /*
    const contactId = `${sessionId}-${contact.id}`;
    
    // Check if contact already exists
    const existingContact = await this.contactRepository.findOne({
      where: { id: contactId },
    });
    
    if (!existingContact) {
      // Create new contact entity
      const contactEntity = new ContactData();
      contactEntity.id = contactId;
      contactEntity.sessionId = sessionId;
      contactEntity.jid = contact.id;
      contactEntity.name = contact.name || '';
      contactEntity.pushName = contact.notify || '';
      contactEntity.metadata = {
        imgUrl: contact.imgUrl || null,
        status: contact.status || null,
        statusTimestamp: contact.statusTimestamp || null,
        businessProfile: contact.verifiedName ? {
          verifiedName: contact.verifiedName,
          // other business fields
        } : null
      };
      contactEntity.updatedAt = new Date();
      
      await this.contactRepository.save(contactEntity);
    }
    */
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to store contact ${contact.id} in session ${sessionId}:`,
        err,
      );
    }
  }
}
