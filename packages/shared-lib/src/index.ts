// packages/shared-lib/src/index.ts

// Export DTOs
export * from './dto/connect.dto';
export * from './dto/delete-messages.dto';
export * from './dto/disconnect.dto';
export * from './dto/get-all-groups.dto';
export * from './dto/send-message-groups.dto';
export * from './dto/send-message.dto';
export * from './dto/verify-connection.dto';
// Add any other DTOs you move here

// Export Proto Interfaces and Types
export * from './protos/wc'; // Assuming wc.ts is moved to packages/shared-lib/src/protos/

// Export Shared Types
export * from './types/client-meta.type'; // Assuming ClientType etc. are moved here

// Export Utilities (if any)
// export * from './utils/some-utility';

// Export Constants (if any)
// export * from './constants/some-constants';