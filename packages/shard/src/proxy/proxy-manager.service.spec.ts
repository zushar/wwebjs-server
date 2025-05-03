// packages/shard/src/proxy/proxy-manager.service.spec.ts
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ProxyManagerService } from './proxy-manager.service';

// Mock the ConfigService
const mockConfigService = {
  get: jest.fn(),
};

describe('ProxyManagerService', () => {
  let service: ProxyManagerService;
  let configService: ConfigService;

  beforeEach(async () => {
    // Reset mocks before each test
    mockConfigService.get.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyManagerService,
        { provide: ConfigService, useValue: mockConfigService },
        // Logger is automatically handled by NestJS testing, but you could provide a mock if needed
      ],
    }).compile();

    service = module.get<ProxyManagerService>(ProxyManagerService);
    configService = module.get<ConfigService>(ConfigService);

    // Suppress console logs during tests for cleaner output
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit / loadProxies', () => {
    it('should load proxies from ConfigService on init', () => {
      const proxies = 'http://proxy1.com,http://proxy2.com';
      mockConfigService.get.mockReturnValue(proxies);

      service.onModuleInit(); // Manually trigger init

      expect(configService.get).toHaveBeenCalledWith('PROXIES');
      expect(service.getUsageCounts().size).toBe(2);
      expect(service.getUsageCounts().get('http://proxy1.com')).toBe(0);
      expect(service.getUsageCounts().get('http://proxy2.com')).toBe(0);
    });

    it('should handle empty proxy list from ConfigService', () => {
      mockConfigService.get.mockReturnValue('');
      service.onModuleInit();
      expect(service.getUsageCounts().size).toBe(0);
    });

     it('should handle undefined proxy list from ConfigService', () => {
      mockConfigService.get.mockReturnValue(undefined);
      service.onModuleInit();
      expect(service.getUsageCounts().size).toBe(0);
    });
  });

  describe('allocate', () => {
    beforeEach(() => {
       // Setup proxies for allocation tests
       const proxies = 'http://proxy1.com,http://proxy2.com';
       mockConfigService.get.mockReturnValue(proxies);
       service.onModuleInit(); // Initialize with these proxies
    });

    it('should allocate the first available proxy', () => {
      const proxy = service.allocate();
      expect(proxy).toBe('http://proxy1.com');
      expect(service.getUsageCounts().get('http://proxy1.com')).toBe(1);
      expect(service.getUsageCounts().get('http://proxy2.com')).toBe(0);
    });

    it('should allocate the next proxy if the first is full', () => {
       // Fill up proxy1 (assuming MAX_CLIENTS_PER_PROXY is 50)
       for (let i = 0; i < 50; i++) {
         service.allocate();
       }
       expect(service.getUsageCounts().get('http://proxy1.com')).toBe(50);

       const proxy2 = service.allocate();
       expect(proxy2).toBe('http://proxy2.com');
       expect(service.getUsageCounts().get('http://proxy2.com')).toBe(1);
    });

    it('should throw InternalServerErrorException if all proxies are full', () => {
        // Fill up proxy1 and proxy2
       for (let i = 0; i < 100; i++) { // 2 proxies * 50 capacity
         service.allocate();
       }
       expect(service.getUsageCounts().get('http://proxy1.com')).toBe(50);
       expect(service.getUsageCounts().get('http://proxy2.com')).toBe(50);

       expect(() => service.allocate()).toThrow(InternalServerErrorException);
       expect(() => service.allocate()).toThrow('All proxies are currently at full capacity.');
    });

     it('should return null if no proxies are configured', () => {
       // Re-initialize service with no proxies
       mockConfigService.get.mockReturnValue(undefined);
       service.onModuleInit();

       const proxy = service.allocate();
       expect(proxy).toBeNull();
    });
  });

   describe('release', () => {
      const proxy1 = 'http://proxy1.com';
       beforeEach(() => {
         // Setup proxies and allocate one
         const proxies = `${proxy1},http://proxy2.com`;
         mockConfigService.get.mockReturnValue(proxies);
         service.onModuleInit();
         service.allocate(); // Allocate proxy1, count becomes 1
      });

       it('should decrease the usage count for a released proxy', () => {
         expect(service.getUsageCounts().get(proxy1)).toBe(1);
         service.release(proxy1);
         expect(service.getUsageCounts().get(proxy1)).toBe(0);
       });

        it('should not decrease count below zero', () => {
          service.release(proxy1); // Count becomes 0
          expect(service.getUsageCounts().get(proxy1)).toBe(0);
          service.release(proxy1); // Try releasing again
          expect(service.getUsageCounts().get(proxy1)).toBe(0); // Should still be 0
        });

        it('should handle releasing an unknown proxy gracefully', () => {
          const unknownProxy = 'http://unknown.com';
          expect(() => service.release(unknownProxy)).not.toThrow();
           expect(service.getUsageCounts().has(unknownProxy)).toBe(false);
        });

         it('should handle releasing a null proxy gracefully', () => {
          expect(() => service.release(null)).not.toThrow();
        });
   });

});