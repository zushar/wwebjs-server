import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientOptions, LocalAuth } from 'whatsapp-web.js';

@Injectable()
export class ClientFactoryService {
  private readonly logger = new Logger(ClientFactoryService.name);

  /**
   * Creates a new WhatsApp Web.js client with consistent configuration
   * @param phoneNumber The phone number to associate with this client
   * @returns A configured Client instance
   */
  createClient(phoneNumber: string): Client {
    this.logger.debug(`Creating WhatsApp client for: ${phoneNumber}`);
    const defaultOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: phoneNumber,
      }),
      puppeteer: {
        headless: true, // Set to false for debugging if needed
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-features=site-per-process',
          '--window-size=1920,1080',
          '--js-flags="--max-old-space-size=128"', // Limit JS heap to 128MB per Chromium
        ],
      },
    };

    return new Client(defaultOptions);
  }
}
