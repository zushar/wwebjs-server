// send-message.dto.ts
import { IsString } from 'class-validator';
export class SendMessageDto {
  @IsString() clientId!: string;
  @IsString() recipientId!: string;
  @IsString() message!: string;
}
