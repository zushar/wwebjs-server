// packages/shard/src/main.ts
import { Logger } from '@nestjs/common'; // Import Logger
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('ShardBootstrap'); // Create a logger instance

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'wc', // Package name defined in proto
        protoPath: join(process.cwd(), 'proto/whatsapp_shard.proto'),
        url: process.env.SHARD_GRPC_URL || '0.0.0.0:50051', // Listen on all interfaces
        loader: {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        },
      },
    },
  );
  logger.log(
    `Attempting to load proto file from: ${join(process.cwd(), 'proto/whatsapp_shard.proto')}`,
  );

  // Optional: Add graceful shutdown hooks here if needed
  // app.enableShutdownHooks();

  await app.listen();
  logger.log(
    `Shard gRPC Microservice is listening on ${process.env.SHARD_GRPC_URL || '0.0.0.0:50051'}`,
  );

  // --- Optional: Hybrid Application for Health Checks ---
  // If you need HTTP health checks on the same instance:
  /*
  const httpApp = await NestFactory.create(AppModule); // Create a separate HTTP app instance *sharing the same module*
  const healthPort = process.env.SHARD_HEALTH_PORT || 3001;
  await httpApp.listen(healthPort);
  logger.log(`Shard HTTP Health Check endpoint listening on port ${healthPort}`);
  */
  // Note: This hybrid approach requires careful management of shared resources.
  // Alternatively, implement health checks directly within the gRPC service if the framework supports it,
  // or run a separate minimal HTTP server just for health checks.
}
bootstrap();
