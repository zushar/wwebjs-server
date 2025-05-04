// session-persistence.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientMeta } from '@whatsapp-cluster/shared-lib';
import * as fs from 'fs/promises';
import Redis from 'ioredis';
import * as path from 'path';
import { REDIS_CLIENT } from '../redis/redis.module';

const SESSIONS_BASE_PATH = path.resolve(process.cwd(), './sessions');

@Injectable()
export class SessionPersistenceService {
  private readonly logger = new Logger(SessionPersistenceService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  // מתודות לניהול Redis
  getRedisKey(clientId: string): string {
    return `wa-client:${clientId}`;
  }

  async getClientMeta(clientId: string): Promise<ClientMeta | null> {
    const redisKey = this.getRedisKey(clientId);
    const data = await this.redisClient.get(redisKey);
    if (!data) {
      this.logger.warn(
        `No Redis record found for ${clientId} during metadata retrieval.`,
      );
      return null;
    }
    try {
      const parsedData = JSON.parse(data) as ClientMeta;
      this.logger.log(
        `Client metadata retrieved from Redis for ${clientId}: ${JSON.stringify(
          parsedData,
        )}`,
      );
      return parsedData;
    } catch (e) {
      this.logger.error(
        `Failed to parse Redis data for ${clientId} during metadata retrieval: ${data}`,
        e,
      );
      return null;
    }
  }

  async saveClientMeta(clientId: string, meta: ClientMeta): Promise<boolean> {
    try {
      await this.redisClient.set(
        this.getRedisKey(clientId),
        JSON.stringify(meta),
      );
      this.logger.log(`Stored client metadata in Redis for ${clientId}`);
      return true;
    } catch (e) {
      this.logger.error(
        `Failed to store client metadata in Redis for ${clientId}: ${e.message}`,
        e.stack,
      );
      return false;
    }
  }

  async isClientVerified(clientId: string): Promise<boolean> {
    const redisKey = this.getRedisKey(clientId);
    const data = await this.redisClient.get(redisKey);
    if (!data) {
      this.logger.warn(
        `No Redis record found for ${clientId} during verification check.`,
      );
      return false;
    }
    try {
      const parsedData = JSON.parse(data) as ClientMeta;
      return parsedData.verified;
    } catch (e) {
      this.logger.error(
        `Failed to parse Redis data for ${clientId} during verification check: ${data}`,
        e,
      );
      return false;
    }
  }

  // מתודות לניהול קבצי סשן
  async cleanupSessionFiles(clientId: string): Promise<void> {
    const authPath = path.join(SESSIONS_BASE_PATH, `session-${clientId}`);
    try {
      await fs.rm(authPath, { recursive: true, force: true });
      this.logger.log(`Cleaned up session files for ${clientId} at ${authPath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        this.logger.error(`Error deleting session files for ${clientId} at ${authPath}:`, err);
      } else {
        this.logger.log(`Session directory ${authPath} not found during cleanup, skipping deletion.`);
      }
    }
  }

  async cleanupRedisAndFiles(clientId: string): Promise<void> {
    // Delete Redis key
    try {
      const deletedCount = await this.redisClient.del(this.getRedisKey(clientId));
      if (deletedCount > 0) {
        this.logger.log(`Deleted Redis key for ${clientId}.`);
      } else {
        this.logger.log(`Redis key for ${clientId} not found or already deleted.`);
      }
    } catch (e: any) {
      this.logger.error(`Error deleting Redis key for ${clientId}: ${e.message}`, e.stack);
    }

    // Delete session files
    await this.cleanupSessionFiles(clientId);
  }

  async findSessionDirectories(): Promise<string[]> {
    try {
      await fs.mkdir(SESSIONS_BASE_PATH, { recursive: true });
      const entries = await fs.readdir(SESSIONS_BASE_PATH, { withFileTypes: true });
      const sessionDirs = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('session-'))
        .map(entry => entry.name.substring('session-'.length));
      
      return sessionDirs;
    } catch (error: any) {
      this.logger.error(
        `Failed to read session directory ${SESSIONS_BASE_PATH}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }
}
