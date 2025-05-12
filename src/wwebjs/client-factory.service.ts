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
        dataPath: `./whatsapp-session/${phoneNumber}`,
      }),
      puppeteer: {
        headless: true, // Set to false for debugging if needed
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
        ],
      },
    };
    return new Client(defaultOptions);
  }
}
