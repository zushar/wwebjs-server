import { Controller, Get, Inject, Query } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

@Controller('redis-test')
export class RedisTestController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Get()
  async getKey(@Query('key') key: string): Promise<string | null> {
    const redisKey = `wa-client:${key}`;
    const value = await this.redis.get(redisKey);
    return value;
  }
}
