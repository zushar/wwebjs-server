import { Client } from 'whatsapp-web.js';

export type ClientType = 'delete-only' | 'full';

export interface ClientMeta {
  id: string;
  type: ClientType;
  lastActive: number;
}

export type ClientState = {
  id: string;
  client: Client;
  ready: boolean;
  lastActive: number;
  clientType: ClientType;
};
