// packages/shard/src/wwebjs/client-factory.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fetch from 'node-fetch';
import { Client, ClientOptions, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class ClientFactoryService {
  private readonly logger = new Logger(ClientFactoryService.name);

  constructor(private configService: ConfigService) {}

  async createClient(phoneNumber: string, proxyUrl: string | null): Promise<Client> {
    this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}${proxyUrl ? ' via proxy ' + proxyUrl.split('@')[1] : ''}`);

    const browserHttpEndpoint = this.configService.get<string>(
      'BROWSER_POOL_ENDPOINT',
    );

    if (!browserHttpEndpoint || !browserHttpEndpoint.startsWith('http')) {
      this.logger.error(
        'BROWSER_POOL_ENDPOINT env var must be set to the HTTP endpoint (e.g., http://browser-pool:9223)',
      );
      throw new Error('Browser Pool endpoint is not configured correctly.');
    }

    let dynamicWSEndpoint: string | undefined;
    try {
      // Add the Host header to fix the 500 error
      const response = await fetch(`${browserHttpEndpoint}/json/version`, {
        headers: {
          'Host': 'localhost'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error fetching browser version! status: ${response.status}`);
      }
      
      const versionInfo = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      };
      
      dynamicWSEndpoint = versionInfo.webSocketDebuggerUrl;
      if (!dynamicWSEndpoint) {
        throw new Error('webSocketDebuggerUrl not found in version response.');
      }
      
      dynamicWSEndpoint = dynamicWSEndpoint.replace('ws://localhost', 'ws://browser-pool');
      dynamicWSEndpoint = dynamicWSEndpoint.replace('ws://127.0.0.1', 'ws://browser-pool');
      
      this.logger.debug(`Discovered WebSocket endpoint: ${dynamicWSEndpoint}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch browser WebSocket endpoint from ${browserHttpEndpoint}/json/version: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not connect to browser pool: ${error.message}`);
    }

    const puppeteerOptions: ClientOptions['puppeteer'] = {
      headless: true,
      browserWSEndpoint: dynamicWSEndpoint,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
    };

    if (proxyUrl) {
      // Check if it's a test/example proxy
      if (!proxyUrl.includes('://') || !proxyUrl.includes('@')) {
        this.logger.warn(`Proxy URL format may be invalid: ${proxyUrl.split('@')[0]}@*****. Expected format: protocol://user:pass@host:port`);
      }
      if (proxyUrl.includes('example.com')) {
        this.logger.warn(`Using example proxy URL (${proxyUrl.split('@')[1]}). This may not work in production.`);
        // You might want to add special handling for test proxies here
        // For example, you could use a real proxy for testing or modify the URL
      }
      
      puppeteerOptions.args = puppeteerOptions.args || [];
      puppeteerOptions.args.push(`--proxy-server=${proxyUrl}`);
      this.logger.log(`Using proxy server arg for puppeteer: --proxy-server=${proxyUrl.split('@')[0]}@*****`);
    } else {
      puppeteerOptions.args = puppeteerOptions.args || [];
      puppeteerOptions.args.push('--no-proxy-server');
      this.logger.log('No proxy server configured for this client.');
    }

    const clientOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: phoneNumber,
        dataPath: './sessions',
      }),
      puppeteer: puppeteerOptions,
      authTimeoutMs: 90000,
      takeoverTimeoutMs: 90000,
      qrMaxRetries: 10,
    };

    try {
      return new Client(clientOptions);
    } catch (error) {
      this.logger.error(`Failed to create WhatsApp client for ${phoneNumber}: ${error.message}`, error.stack);
      throw new Error(`Client creation failed: ${error.message}`);
    }
  }
}
