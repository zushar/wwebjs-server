import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { existsSync } from 'fs';
import { join } from 'path';
import { GatewayController } from './gateway.controller';

// Try different possible paths for the proto file
const possiblePaths = [
  join(__dirname, '../../proto/whatsapp_shard.proto'),
  join(__dirname, '../../../proto/whatsapp_shard.proto'),
  '/usr/src/app/proto/whatsapp_shard.proto',
  join(__dirname, './proto/whatsapp_shard.proto'),
];

// Find the first path that exists
let protoPath = possiblePaths.find(path => existsSync(path));

if (!protoPath) {
  console.error('Proto file not found in any of the expected locations:');
  possiblePaths.forEach(path => console.error(`- ${path}`));
  
  // List directories to help debug
  console.error('Directory structure:');
  const rootDir = '/usr/src/app';
  if (existsSync(rootDir)) {
    console.error(`Contents of ${rootDir}:`, require('fs').readdirSync(rootDir));
    
    const packagesDir = join(rootDir, 'packages');
    if (existsSync(packagesDir)) {
      console.error(`Contents of ${packagesDir}:`, require('fs').readdirSync(packagesDir));
    }
    
    const protoDir = join(rootDir, 'proto');
    if (existsSync(protoDir)) {
      console.error(`Contents of ${protoDir}:`, require('fs').readdirSync(protoDir));
    }
  }
  
  // Default to the first path even though it doesn't exist (will fail later)
  protoPath = possiblePaths[0];
}

console.log('Using proto file at:', protoPath);

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'SHARD_SERVICE',
        transport: Transport.GRPC,
        options: {
          package: 'wc',
          protoPath: protoPath,
          url: process.env.SHARD_ADDR || 'localhost:50051',
        },
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [GatewayController],
})
export class AppModule {}
