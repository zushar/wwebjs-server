# Dockerfile for the gateway service in the WhatsApp Cluster project
# ==== Build Stage ====
FROM node:22-alpine AS builder

# Install pnpm and build dependencies
RUN npm install -g pnpm
RUN apk add --no-cache curl python3 make g++

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/shared-lib/package.json ./packages/shared-lib/

# Create necessary directories
RUN mkdir -p packages/gateway packages/shared-lib packages/proto

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the proto files
COPY packages/proto ./packages/proto/

# Copy the rest of the source code
COPY . .

# Build shared-lib first (since gateway depends on it)
RUN pnpm --filter=@whatsapp-cluster/shared-lib build

# Then build the gateway application
RUN pnpm --filter=@whatsapp-cluster/gateway build

# ==== Production Stage ====
FROM node:22-alpine

# Install runtime dependencies
RUN apk add --no-cache curl

# Set the working directory
WORKDIR /usr/src/app

# Create necessary directories
RUN mkdir -p proto

# Copy package files
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/pnpm-lock.yaml ./
COPY --from=builder /usr/src/app/pnpm-workspace.yaml ./
COPY --from=builder /usr/src/app/packages/gateway/package.json ./packages/gateway/
COPY --from=builder /usr/src/app/packages/shared-lib/package.json ./packages/shared-lib/

# Copy the node_modules from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages/gateway/node_modules ./packages/gateway/node_modules
COPY --from=builder /usr/src/app/packages/shared-lib/node_modules ./packages/shared-lib/node_modules

# Copy the built application code
COPY --from=builder /usr/src/app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /usr/src/app/packages/shared-lib/dist ./packages/shared-lib/dist

# Copy proto files needed by NestJS gRPC at runtime
COPY --from=builder /usr/src/app/packages/proto/whatsapp_shard.proto ./proto/

# Expose the HTTP port the gateway service listens on
EXPOSE 3000

# Define the command to run the application
CMD ["node", "packages/gateway/dist/main.js"]
