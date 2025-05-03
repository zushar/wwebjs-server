// packages/shard/src/wwebjs/connect.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ClientMeta } from '@whatsapp-cluster/shared-lib'; // Adjust the import path as necessary
import * as fs from 'fs/promises'; // Import fs promises
import Redis from 'ioredis'; // Import the type
import * as path from 'path'; // Import path
import { Client as WWebClient } from 'whatsapp-web.js'; // Alias to avoid name clash
import { ProxyManagerService } from '../proxy/proxy-manager.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ConnectService } from './connect.service';


// --- Mocks ---
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
};

const mockClientFactory = {
  createClient: jest.fn(),
};

const mockProxyManager = {
  allocate: jest.fn(),
  release: jest.fn(),
  getUsageCounts: jest.fn(), // Add if needed
};

// Mock the actual whatsapp-web.js client
const mockWWebClient = {
  initialize: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  requestPairingCode: jest.fn(),
  // Add other methods used by ConnectService or WwebjsServices if testing those interactions
};

// Mock fs/promises
jest.mock('fs/promises', () => ({
  rm: jest.fn().mockResolvedValue(undefined),
  // Mock other fs functions if ConnectService uses them directly
}));

describe('ConnectService', () => {
  let service: ConnectService;
  let redisClient: Redis; // Use the Redis type alias
  let clientFactory: ClientFactoryService;
  let proxyManager: ProxyManagerService;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    (mockWWebClient.initialize as jest.Mock).mockResolvedValue(undefined);
    (mockWWebClient.destroy as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined); // Reset fs mock

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
        { provide: ClientFactoryService, useValue: mockClientFactory },
        { provide: ProxyManagerService, useValue: mockProxyManager },
      ],
    }).compile();

    service = module.get<ConnectService>(ConnectService);
    redisClient = module.get<Redis>(REDIS_CLIENT);
    clientFactory = module.get<ClientFactoryService>(ClientFactoryService);
    proxyManager = module.get<ProxyManagerService>(ProxyManagerService);

    // Mock createClient to return our mock wweb client instance
    mockClientFactory.createClient.mockResolvedValue(mockWWebClient as any);

    // Suppress logs
    jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getClientMeta', () => {
    it('should return parsed metadata if found in Redis', async () => {
      const phoneNumber = '123';
      const meta: ClientMeta = { id: phoneNumber, verified: true, type: 'full', lastActive: Date.now(), proxy: 'p1' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(meta));

      const result = await service.getClientMeta(phoneNumber);

      expect(result).toEqual(meta);
      expect(mockRedisClient.get).toHaveBeenCalledWith(`wa-client:${phoneNumber}`);
    });

    it('should return null if not found in Redis', async () => {
      const phoneNumber = '123';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.getClientMeta(phoneNumber);

      expect(result).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalledWith(`wa-client:${phoneNumber}`);
    });

     it('should return null on Redis parse error', async () => {
      const phoneNumber = '123';
      mockRedisClient.get.mockResolvedValue('{invalid json'); // Simulate invalid JSON

      const result = await service.getClientMeta(phoneNumber);

      expect(result).toBeNull();
    });
  });

   describe('isClientVerified', () => {
    it('should return true if Redis data indicates verified', async () => {
      const phoneNumber = '123';
      const meta: ClientMeta = { id: phoneNumber, verified: true, type: 'full', lastActive: Date.now(), proxy: 'p1' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(meta));
      expect(await service.isClientVerified(phoneNumber)).toBe(true);
    });

     it('should return false if Redis data indicates not verified', async () => {
      const phoneNumber = '123';
      const meta: ClientMeta = { id: phoneNumber, verified: false, type: 'full', lastActive: Date.now(), proxy: 'p1' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(meta));
      expect(await service.isClientVerified(phoneNumber)).toBe(false);
    });

     it('should return false if Redis data not found', async () => {
      const phoneNumber = '123';
      mockRedisClient.get.mockResolvedValue(null);
      expect(await service.isClientVerified(phoneNumber)).toBe(false);
    });
   });

   describe('disconnectClient', () => {
     const clientId = 'client1';
     const proxy = 'http://proxy.com';

     it('should call cleanupClient if client exists in memory', async () => {
        // Add a mock client to the internal map
        service['clients'].set(clientId, {
            id: clientId,
            client: mockWWebClient as any,
            ready: true,
            verified: true,
            clientType: 'full',
            lastActive: Date.now(),
            proxy: proxy,
        });

        const result = await service.disconnectClient(clientId);

        expect(result.success).toBe(true);
        expect(result.message).toBe('Client disconnected successfully.');
        expect(mockWWebClient.destroy).toHaveBeenCalledTimes(1);
        expect(mockProxyManager.release).toHaveBeenCalledWith(proxy);
        expect(mockRedisClient.del).toHaveBeenCalledWith(`wa-client:${clientId}`);
        expect(fs.rm).toHaveBeenCalledWith(path.resolve('./sessions', `session-${clientId}`), expect.anything());
        expect(service['clients'].has(clientId)).toBe(false);
     });

     it('should remove stale Redis key if client not in memory but exists in Redis', async () => {
       mockRedisClient.exists.mockResolvedValue(1); // Simulate exists in Redis

       const result = await service.disconnectClient(clientId);

       expect(result.success).toBe(true);
       expect(result.message).toBe('Client not active, stale data cleaned up.');
       expect(mockRedisClient.del).toHaveBeenCalledWith(`wa-client:${clientId}`);
        expect(fs.rm).toHaveBeenCalledWith(path.resolve('./sessions', `session-${clientId}`), expect.anything());
       expect(mockWWebClient.destroy).not.toHaveBeenCalled();
       expect(mockProxyManager.release).not.toHaveBeenCalled();
     });

      it('should return not found if client not in memory or Redis', async () => {
       mockRedisClient.exists.mockResolvedValue(0); // Simulate not in Redis

       const result = await service.disconnectClient(clientId);

       expect(result.success).toBe(false);
       expect(result.message).toBe('Client not found.');
       expect(mockRedisClient.del).not.toHaveBeenCalled();
        expect(fs.rm).not.toHaveBeenCalled();
       expect(mockWWebClient.destroy).not.toHaveBeenCalled();
       expect(mockProxyManager.release).not.toHaveBeenCalled();
     });
   });

   // Note: Testing createVerificationCode fully is hard in unit tests
   // due to the async events ('qr', 'ready', 'disconnected').
   // You might test the initial setup part:
   describe('createVerificationCode (initial part)', () => {
     const phoneNumber = 'phone1';
     const clientType = 'full';
     const proxy = 'http://proxy.com';

     beforeEach(() => {
       mockProxyManager.allocate.mockReturnValue(proxy);
     });

     it('should allocate a proxy', async () => {
       // We can't easily await the full promise here in a unit test without complex event mocking.
       // So, we'll just check if the initial synchronous/immediately async parts run.
       service.createVerificationCode(phoneNumber, clientType);
       await Promise.resolve(); // Allow microtasks like the proxy allocation promise to settle

       expect(mockProxyManager.allocate).toHaveBeenCalledTimes(1);
     });

     it('should create a client via the factory', async () => {
       service.createVerificationCode(phoneNumber, clientType);
        await Promise.resolve();

       expect(mockClientFactory.createClient).toHaveBeenCalledWith(phoneNumber, proxy);
     });

      it('should add the client state to the map', async () => {
       service.createVerificationCode(phoneNumber, clientType);
        await Promise.resolve();

       expect(service['clients'].has(phoneNumber)).toBe(true);
       const state = service['clients'].get(phoneNumber);
       if (!state) throw new Error('State not found in map');
       expect(state.id).toBe(phoneNumber);
       expect(state.client).toBe(mockWWebClient);
       expect(state.ready).toBe(false); // Initially false
       expect(state.verified).toBe(false); // Initially false unless overridden
       expect(state.proxy).toBe(proxy);
       expect(state.clientType).toBe(clientType);
     });

      it('should store initial unverified status in Redis', async () => {
        service.createVerificationCode(phoneNumber, clientType);
        await Promise.resolve(); // Allow async setup like proxy alloc

        expect(mockRedisClient.set).toHaveBeenCalledWith(
            `wa-client:${phoneNumber}`,
            expect.any(String) // Check it was called, maybe JSON.stringify the expected meta
        );
     });

     // Add tests for how it handles existing clients in the map...
   });

});