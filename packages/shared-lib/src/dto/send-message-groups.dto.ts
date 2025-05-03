// send-message-groups.dto.ts
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
export class SendMessageGroupsDto {
  @IsString() clientId!: string;
  @IsArray() @ArrayNotEmpty() groupIds!: string[];
  @IsString() message!: string;
}
