// client-session-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ClientMeta } from '@whatsapp-cluster/shared-lib';
import { ClientState } from './client-meta.type';

@Injectable()
export class ClientSessionManagerService {
  private readonly logger = new Logger(ClientSessionManagerService.name);
  private clients: Map<string, ClientState> = new Map();

  /*
    * Adds a new client to the session manager.
    * @param clientId - The ID of the client.
    * @param client - The WhatsApp client instance.
    * @param clientType - The type of the client (e.g., 'delete-only', 'full').
    * @param proxy - The proxy URL if any.
    */
  getClientState(clientId: string): ClientState | undefined {
    return this.clients.get(clientId);
  }
  /*
    * Updates the state of an existing client.
    * @param clientId - The ID of the client.
    * @param state - The new state of the client.
    */
  setClientState(clientId: string, state: ClientState): void {
    this.clients.set(clientId, state);
    this.logger.log(`Updated client state for ${clientId}`);
  }

  /*
    * Adds a new client to the session manager.
    * @param clientId - The ID of the client.
    * @param client - The WhatsApp client instance.
    * @param clientType - The type of the client (e.g., 'delete-only', 'full').
    * @param proxy - The proxy URL if any.
    */
  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  removeClient(clientId: string): boolean {
    return this.clients.delete(clientId);
  }
/*
    * Retrieves a client from the session manager.
    * @param clientId - The ID of the client.
    * @returns The client instance and its state or undefined if id is not in map.
    */
  getClient(clientId: string): ClientState | undefined {
    const clientData = this.clients.get(clientId);
    if (!clientData) {
      const errorMsg = `Client for ID ${clientId} not found in memory`;
      this.logger.error(errorMsg);
      return undefined;
    }
    if (!clientData.ready) {
      const errorMsg = `Client for ID ${clientId} is not ready`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    this.logger.log(`Client ${clientId} found in memory and ready.`);
    return clientData;
  }

  // המרה מ-ClientState ל-ClientMeta לשמירה ב-Redis
  toClientMeta(state: ClientState): ClientMeta {
    return {
      id: state.id,
      verified: state.verified,
      type: state.clientType,
      lastActive: state.lastActive,
      proxy: state.proxy,
    };
  }
}
