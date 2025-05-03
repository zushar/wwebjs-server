// packages/shared-lib/src/types/client-meta.type.ts

export type ClientType = 'delete-only' | 'full';

export interface ClientMeta {
  id: string;
  verified: boolean;
  type: ClientType;
  lastActive: number;
  proxy: string | null;
}
