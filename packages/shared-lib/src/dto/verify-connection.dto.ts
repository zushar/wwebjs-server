// verify-connection.dto.ts
import { IsString } from 'class-validator';
export class VerifyConnectionDto {
  @IsString() clientId!: string;
}
