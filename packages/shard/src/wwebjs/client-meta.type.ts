// packages/shard/src/wwebjs/client-meta.type.ts
import { ClientType } from '@whatsapp-cluster/shared-lib';
import { Client } from 'whatsapp-web.js';

export type ClientState = {
  id: string;
  client: Client;
  ready: boolean;
  verified: boolean;
  lastActive: number;
  clientType: ClientType;
  proxy: string | null;
};