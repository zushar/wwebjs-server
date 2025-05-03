// get-all-groups.dto.ts
import { IsString } from 'class-validator';
export class GetAllGroupsDto {
  @IsString() clientId!: string;
}
