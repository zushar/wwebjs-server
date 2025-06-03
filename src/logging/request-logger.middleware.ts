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
    // Capture start time as a typed tuple
    const start: [number, number] = process.hrtime();

    // Generate a unique request ID
    const requestId = Math.random().toString(36).substring(2, 15);

    // Add request ID to response headers for tracking
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
      // Calculate duration
      const [s, ns]: [number, number] = process.hrtime(start);
      const ms = (s * 1e3 + ns / 1e6).toFixed(3);

      const { method, originalUrl, ip } = req;
      const { statusCode } = res;

      // Create a structured log object
      const logData = {
        requestId,
        method,
        url: originalUrl,
        statusCode,
        duration: `${ms} ms`,
        ip,
      };

      // Log with appropriate level based on status code
      if (statusCode >= 500) {
        this.logger.error(`Request failed: ${method} ${originalUrl}`, {
          ...logData,
          context: 'HTTP',
        });
      } else if (statusCode >= 400) {
        this.logger.warn(`Request warning: ${method} ${originalUrl}`, {
          ...logData,
          context: 'HTTP',
        });
      } else {
        this.logger.log(`Request completed: ${method} ${originalUrl}`, {
          ...logData,
          context: 'HTTP',
        });
      }

      // Log request details at debug level
      const params = req.params as Record<string, unknown>;
      const query = req.query as Record<string, unknown>;
      const body = req.body as Record<string, unknown>;

      if (Object.keys(params).length) {
        this.logger.debug?.(`Request params`, {
          requestId,
          params,
          context: 'HTTP',
        });
      }

      if (Object.keys(query).length) {
        this.logger.debug?.(`Request query`, {
          requestId,
          query,
          context: 'HTTP',
        });
      }

      if (body && typeof body === 'object' && Object.keys(body).length) {
        // Sanitize sensitive data if needed
        const sanitizedBody = { ...body } as Record<string, unknown>;
        if ('password' in sanitizedBody) {
          sanitizedBody.password = '********';
        }

        this.logger.debug?.(`Request body`, {
          requestId,
          body: sanitizedBody,
          context: 'HTTP',
        });
      }
    });

    next();
  }
}
