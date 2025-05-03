import { Observable } from 'rxjs';

export interface ConnectRequest {
  phoneNumber: string;
  clientType: string;
}
export interface ConnectResponse {
  clientId: string;
  pairingCode?: string;
  message: string;
  needsPairing: boolean;
}
export interface VerifyConnectionRequest {
  clientId: string;
}
export interface VerifyConnectionResponse {
  success: boolean;
  message: string;
}
export interface SendMessageRequest {
  clientId: string;
  recipientId: string;
  message: string;
}
export interface SendMessageResponse {
  success: boolean;
  messageId: string;
  error: string;
}
export interface ClientIdRequest {
  clientId: string;
}
export interface GetAllGroupsRequest {
  clientId: string;
}
export interface GetAllGroupsResponse {
  groups: { id: string; name: string }[];
}
export interface DeleteMessagesFromGroupsRequest {
  clientId: string;
  groupIds: string[];
}
export interface SendMessageToGroupsRequest {
  clientId: string;
  groupIds: string[];
  message: string;
}
export interface ActionConfirmationResponse {
  successfulIds: string[];
  failedIds: string[];
  message: string;
}
export interface DisconnectRequest {
  clientId: string;
}
export interface DisconnectResponse {
  success: boolean;
  message: string;
}
export type HealthCheckRequest = Record<string, never>;
export interface HealthCheckResponse {
  status: number;
}

export interface ShardServiceClient {
  Connect(request: ConnectRequest): Observable<ConnectResponse>;
  VerifyConnection(
    request: VerifyConnectionRequest,
  ): Observable<VerifyConnectionResponse>;
  SendMessage(request: SendMessageRequest): Observable<SendMessageResponse>;
  GetAllGroups(request: GetAllGroupsRequest): Observable<GetAllGroupsResponse>;
  GetAllArchivedGroups(
    request: GetAllGroupsRequest,
  ): Observable<GetAllGroupsResponse>;
  DeleteMessagesFromGroups(
    request: DeleteMessagesFromGroupsRequest,
  ): Observable<ActionConfirmationResponse>;
  DeleteAllMessagesFromArchivedGroups(
    request: ClientIdRequest,
  ): Observable<ActionConfirmationResponse>;
  SendMessageToGroups(
    request: SendMessageToGroupsRequest,
  ): Observable<ActionConfirmationResponse>;
  Disconnect(request: DisconnectRequest): Observable<DisconnectResponse>;
  HealthCheck(request: HealthCheckRequest): Observable<HealthCheckResponse>;
}
