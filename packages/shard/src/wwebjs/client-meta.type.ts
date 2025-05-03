// packages/shard/src/wwebjs/client-meta.type.ts (Keep ClientState here)
import { ClientType } from '@whatsapp-cluster/shared-lib'; // Adjust the import path as necessary
import { Client } from 'whatsapp-web.js';

export type ClientState = {
  id: string;
  client: Client; // Requires the import
  ready: boolean;
  verified: boolean;
  lastActive: number;
  clientType: ClientType; // Use shared type
  proxy: string | null;
};