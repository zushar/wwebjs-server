// disconnect.dto.ts
import { IsString } from 'class-validator';
export class DisconnectDto {
  @IsString() clientId!: string;
}
