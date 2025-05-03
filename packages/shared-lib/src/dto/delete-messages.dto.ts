// delete-messages.dto.ts
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
export class DeleteMessagesDto {
  @IsString() clientId!: string;
  @IsArray() @ArrayNotEmpty() groupIds!: string[];
}
