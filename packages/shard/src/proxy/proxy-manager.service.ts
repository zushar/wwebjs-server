// packages/shard/src/proxy/proxy-manager.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Define the maximum number of clients allowed per proxy IP
const MAX_CLIENTS_PER_PROXY = 50;

@Injectable()
export class ProxyManagerService implements OnModuleInit {
  private readonly logger = new Logger(ProxyManagerService.name);
  private availableProxies: string[] = [];
  // Map to store the current count of active clients for each proxy
  private proxyUsageCount: Map<string, number> = new Map();

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.loadProxies();
    this.initializeCounts();
    if (this.availableProxies.length === 0) {
      this.logger.warn(
        'PROXIES environment variable is not set or empty. Proxy management will be bypassed.',
      );
    } else {
      this.logger.log(
        `Initialized Proxy Manager with ${this.availableProxies.length} proxies. Max clients per proxy: ${MAX_CLIENTS_PER_PROXY}`,
      );
    }
  }

  private loadProxies() {
    const proxiesEnv = this.configService.get<string>('PROXIES');
    if (proxiesEnv) {
      this.availableProxies = proxiesEnv
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean); // Filter out any empty strings resulting from split/trim
    } else {
      this.availableProxies = [];
    }
  }

  private initializeCounts() {
    // Initialize counts for all loaded proxies to 0
    this.proxyUsageCount.clear();
    this.availableProxies.forEach((proxy) => {
      this.proxyUsageCount.set(proxy, 0);
    });
    // TODO: In a more robust system, you might rehydrate counts from Redis/DB here
    // based on currently active sessions associated with this shard instance.
    // For now, we assume a fresh start or that ConnectService will repopulate counts
    // during session restoration if needed.
  }

  /**
   * Allocates a proxy with fewer than MAX_CLIENTS_PER_PROXY clients.
   * @returns The allocated proxy URL string or null if no proxies are configured.
   * @throws InternalServerErrorException if no proxies are available or all are full.
   */
  allocate(): string | null {
    if (this.availableProxies.length === 0) {
      this.logger.warn(
        'Attempted to allocate proxy, but none are configured. Returning null.',
      );
      // Depending on requirements, you might throw or return null/undefined
      // Returning null allows operation without proxies if none are provided.
      return null;
      // OR: throw new InternalServerErrorException('No proxies configured.');
    }

    // Find the first proxy with usage count below the limit
    for (const proxy of this.availableProxies) {
      const currentCount = this.proxyUsageCount.get(proxy) || 0;
      if (currentCount < MAX_CLIENTS_PER_PROXY) {
        this.proxyUsageCount.set(proxy, currentCount + 1);
        this.logger.log(
          `Allocated proxy ${proxy}. Current usage: ${currentCount + 1}/${MAX_CLIENTS_PER_PROXY}`,
        );
        return proxy;
      }
    }

    // If no proxy is found below the limit
    this.logger.error(
      `Failed to allocate proxy: All ${this.availableProxies.length} proxies are at maximum capacity (${MAX_CLIENTS_PER_PROXY}).`,
    );
    throw new InternalServerErrorException(
      'All proxies are currently at full capacity.',
    );
  }

  /**
   * Releases a proxy, decrementing its usage count.
   * @param proxy The proxy URL string to release.
   */
  release(proxy: string | null): void {
     // If no proxy was actually allocated (e.g., none configured), just return
    if (!proxy) {
        this.logger.debug('Attempted to release a null proxy. Skipping.');
        return;
    }

    if (!this.proxyUsageCount.has(proxy)) {
      this.logger.warn(
        `Attempted to release an unknown proxy: ${proxy}. It might have been removed from config or never allocated.`,
      );
      return; // Ignore if the proxy isn't tracked (e.g., removed from config)
    }

    const currentCount = this.proxyUsageCount.get(proxy);
    if (currentCount && currentCount > 0) {
      this.proxyUsageCount.set(proxy, currentCount - 1);
      this.logger.log(
        `Released proxy ${proxy}. New usage: ${currentCount - 1}/${MAX_CLIENTS_PER_PROXY}`,
      );
    } else {
      this.logger.warn(
        `Attempted to release proxy ${proxy} which already has a usage count of 0.`,
      );
    }
  }

  /**
   * Gets the current usage count for all managed proxies.
   * Useful for monitoring or debugging.
   */
  getUsageCounts(): Map<string, number> {
    return new Map(this.proxyUsageCount); // Return a copy
  }
}