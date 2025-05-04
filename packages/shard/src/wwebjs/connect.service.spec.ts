// packages/shard/src/wwebjs/connect.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ClientMeta } from '@whatsapp-cluster/shared-lib';
import * as fs from 'fs/promises';
import Redis from 'ioredis';
import * as path from 'path';
import { Client as WWebClient } from 'whatsapp-web.js';
import { ProxyManagerService } from '../proxy/proxy-manager.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ClientFactoryService } from './client-factory.service';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientSessionManagerService } from './client-session-manager.service';
import { ConnectService } from './connect.service';
import { SessionPersistenceService } from './session-persistence.service';
import { SessionRestoreService } from './session-restore.service';

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
  getUsageCounts: jest.fn(),
};

const mockWWebClient = {
  initialize: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  requestPairingCode: jest.fn(),
};

// Mock the new services
const mockSessionManager = {
  getClientState: jest.fn(),
  setClientState: jest.fn(),
  removeClient: jest.fn(),
  hasClient: jest.fn(),
  getClient: jest.fn(),
  toClientMeta: jest.fn(),
};

const mockPersistence = {
  getRedisKey: jest.fn().mockImplementation(id => `wa-client:${id}`),
  getClientMeta: jest.fn(),
  saveClientMeta: jest.fn(),
  cleanupSessionFiles: jest.fn(),
  cleanupRedisAndFiles: jest.fn(),
  isClientVerified: jest.fn(),
};

const mockLifecycle = {
  createVerificationCode: jest.fn(),
  cleanupClient: jest.fn(),
  disconnectClient: jest.fn(),
  verifyCode: jest.fn(),
  setupClientListeners: jest.fn(),
};

const mockSessionRestore = {
  restorePersistedClients: jest.fn(),
};

jest.mock('fs/promises', () => ({
  rm: jest.fn().mockResolvedValue(undefined),
}));

describe('ConnectService', () => {
  let service: ConnectService;
  let sessionManager: ClientSessionManagerService;
  let persistence: SessionPersistenceService;
  let lifecycle: ClientLifecycleService;
  let sessionRestore: SessionRestoreService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: ClientSessionManagerService, useValue: mockSessionManager },
        { provide: SessionPersistenceService, useValue: mockPersistence },
        { provide: ClientLifecycleService, useValue: mockLifecycle },
        { provide: SessionRestoreService, useValue: mockSessionRestore },
        { provide: REDIS_CLIENT, useValue: mockRedisClient },
        { provide: ClientFactoryService, useValue: mockClientFactory },
        { provide: ProxyManagerService, useValue: mockProxyManager },
      ],
    }).compile();

    service = module.get<ConnectService>(ConnectService);
    sessionManager = module.get<ClientSessionManagerService>(ClientSessionManagerService);
    persistence = module.get<SessionPersistenceService>(SessionPersistenceService);
    lifecycle = module.get<ClientLifecycleService>(ClientLifecycleService);
    sessionRestore = module.get<SessionRestoreService>(SessionRestoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should call restorePersistedClients', async () => {
      await service.onModuleInit();
      expect(sessionRestore.restorePersistedClients).toHaveBeenCalled();
    });
  });

  describe('createVerificationCode', () => {
    it('should delegate to lifecycle service', async () => {
      const phoneNumber = '123';
      const clientType = 'full';
      const expected = { clientId: phoneNumber, message: 'test' };
      
      mockLifecycle.createVerificationCode.mockResolvedValue(expected);
      
      const result = await service.createVerificationCode(phoneNumber, clientType);
      
      expect(result).toBe(expected);
      expect(lifecycle.createVerificationCode).toHaveBeenCalledWith(phoneNumber, clientType, false);
    });
  });

  describe('verifyCode', () => {
    it('should delegate to lifecycle service', async () => {
      const phoneNumber = '123';
      const expected = { success: true, message: 'verified' };
      
      mockLifecycle.verifyCode.mockResolvedValue(expected);
      
      const result = await service.verifyCode(phoneNumber);
      
      expect(result).toBe(expected);
      expect(lifecycle.verifyCode).toHaveBeenCalledWith(phoneNumber);
    });
  });

  describe('disconnectClient', () => {
    it('should delegate to lifecycle service', async () => {
      const clientId = '123';
      const expected = { success: true, message: 'disconnected' };
      
      mockLifecycle.disconnectClient.mockResolvedValue(expected);
      
      const result = await service.disconnectClient(clientId);
      
      expect(result).toBe(expected);
      expect(lifecycle.disconnectClient).toHaveBeenCalledWith(clientId);
    });
  });

  describe('isClientVerified', () => {
    it('should delegate to persistence service', async () => {
      const phoneNumber = '123';
      
      mockPersistence.isClientVerified.mockResolvedValue(true);
      
      const result = await service.isClientVerified(phoneNumber);
      
      expect(result).toBe(true);
      expect(persistence.isClientVerified).toHaveBeenCalledWith(phoneNumber);
    });
  });
});
