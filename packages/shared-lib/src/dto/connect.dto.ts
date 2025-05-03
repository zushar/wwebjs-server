// connect.dto.ts
import { IsString } from 'class-validator';
export class ConnectDto {
  @IsString()
  phoneNumber!: string;
  @IsString()
  clientType!: string;
}
