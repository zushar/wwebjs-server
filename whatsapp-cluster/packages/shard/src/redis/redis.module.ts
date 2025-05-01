// src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Define injection token
export const REDIS_CLIENT = 'REDIS_CLIENT';

// Optional: makes the module's providers available globally
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT, // the token to be defined
      useFactory: (configService: ConfigService): Redis => {
        return new Redis({
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          // password: configService.get<string>('REDIS_PASSWORD'), // Uncomment if password is provided
          // db: configService.get<number>('REDIS_DB', 0), // Uncomment if a specific DB is desired
        });
      },
      inject: [ConfigService], // Inject ConfigService into useFactory
    },
  ],
  exports: [REDIS_CLIENT], // Export the token for injection in other modules
})
export class RedisModule {}
