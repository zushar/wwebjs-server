// src/mongoDB/baileys-mongo-auth.ts
import {
  BufferJSON,
  initAuthCreds,
  SignalCreds,
  SignalDataSet,
  SignalDataTypeMap,
  SignalKeyStore,
} from '@whiskeysockets/baileys';
import { BaileysAuthStateService } from './baileys-auth-state.service';

type InMemoryKeyStore = {
  [K in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[K] };
};

export function useMongoAuthState(
  authStateService: BaileysAuthStateService,
  namespace: string,
) {
  return {
    async state(): Promise<{
      creds: SignalCreds;
      keys: SignalKeyStore;
    }> {
      // Get and decode creds
      const rawCreds = await authStateService.get(namespace, 'creds');
      const creds: SignalCreds = rawCreds
        ? (JSON.parse(rawCreds, BufferJSON.reviver) as SignalCreds)
        : initAuthCreds();

      // Get and decode keys as a known, safe structure
      const rawKeys = await authStateService.get(namespace, 'keys');
      const keysObj: InMemoryKeyStore = rawKeys
        ? (JSON.parse(rawKeys, BufferJSON.reviver) as InMemoryKeyStore)
        : {};

      const keys: SignalKeyStore = {
        get: <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          const store = keysObj[type] ?? {};
          for (const id of ids) {
            if (id in store) {
              result[id] = store[id] as SignalDataTypeMap[T];
            }
          }
          // Remove 'async' so you can just return a Promise directly
          return Promise.resolve(result);
        },
        set: async (data: SignalDataSet) => {
          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            if (!keysObj[type]) keysObj[type] = {};
            Object.assign(keysObj[type], data[type]);
          }
          await authStateService.set(
            namespace,
            'keys',
            JSON.stringify(keysObj, BufferJSON.replacer),
          );
        },
      };

      return { creds, keys };
    },

    async saveCreds(creds: SignalCreds) {
      await authStateService.set(
        namespace,
        'creds',
        JSON.stringify(creds, BufferJSON.replacer),
      );
    },
  };
}
