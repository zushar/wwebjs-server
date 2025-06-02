// src/logging/request-logger.middleware.ts
import {
  Inject,
  Injectable,
  LoggerService,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // 1) Capture start time as a typed tuple
    const start: [number, number] = process.hrtime();

    res.on('finish', () => {
      // 2) Typed destructuring of the tuple
      const [s, ns]: [number, number] = process.hrtime(start);
      const ms = (s * 1e3 + ns / 1e6).toFixed(3);

      const { method, originalUrl, ip } = req;
      const { statusCode } = res;
      const msg = `${method} ${originalUrl} ${statusCode} — ${ms} ms (${ip})`;

      // 3) Use only LoggerService methods (always‐present)
      if (statusCode >= 500) {
        this.logger.error(msg, 'HTTP');
      } else if (statusCode >= 400) {
        this.logger.warn(msg, 'HTTP');
      } else {
        this.logger.log(msg, 'HTTP');
      }

      // 4) Cast to Record<string,unknown> before JSON.stringify
      const params = req.params as Record<string, unknown>;
      const query = req.query as Record<string, unknown>;
      const body = req.body as Record<string, unknown>;

      if (Object.keys(params).length) {
        this.logger.debug?.(`→ params: ${JSON.stringify(params)}`, 'HTTP');
      }
      if (Object.keys(query).length) {
        this.logger.debug?.(`→ query: ${JSON.stringify(query)}`, 'HTTP');
      }
      if (body && typeof body === 'object' && Object.keys(body).length) {
        this.logger.debug?.(`→ body: ${JSON.stringify(body)}`, 'HTTP');
      }
    });

    next();
  }
}
