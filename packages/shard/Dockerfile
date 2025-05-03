# Dockerfile for the shard service in the WhatsApp Cluster project
# ==== Build Stage ====
FROM node:22-alpine AS builder

# Install pnpm and build dependencies
RUN npm install -g pnpm
RUN apk add --no-cache curl python3 make g++

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shard/package.json ./packages/shard/
COPY packages/shared-lib/package.json ./packages/shared-lib/

# Create necessary directories
RUN mkdir -p packages/shard packages/shared-lib packages/proto

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the proto files
COPY packages/proto ./packages/proto/

# Copy the rest of the source code
COPY . .

# Build shared-lib first (since shard depends on it)
RUN pnpm --filter=@whatsapp-cluster/shared-lib build

# Then build the shard application
RUN pnpm --filter=@whatsapp-cluster/shard build

# ==== Production Stage ====
FROM node:22-alpine

# Install runtime dependencies
RUN apk add --no-cache curl netcat-openbsd

# Set the working directory
WORKDIR /usr/src/app

# Create necessary directories
RUN mkdir -p proto sessions && chmod 777 sessions

# Copy package files
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/pnpm-lock.yaml ./
COPY --from=builder /usr/src/app/pnpm-workspace.yaml ./
COPY --from=builder /usr/src/app/packages/shard/package.json ./packages/shard/
COPY --from=builder /usr/src/app/packages/shared-lib/package.json ./packages/shared-lib/

# Copy the node_modules from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages/shard/node_modules ./packages/shard/node_modules
COPY --from=builder /usr/src/app/packages/shared-lib/node_modules ./packages/shared-lib/node_modules

# Copy the built application code
COPY --from=builder /usr/src/app/packages/shard/dist ./packages/shard/dist
COPY --from=builder /usr/src/app/packages/shared-lib/dist ./packages/shared-lib/dist

# Copy proto files needed by NestJS gRPC at runtime
# This is the critical part - copy to the root proto directory
COPY --from=builder /usr/src/app/packages/proto/whatsapp_shard.proto ./proto/

# Expose the gRPC port the shard service listens on
EXPOSE 50051

# Define the command to run the application
CMD ["node", "packages/shard/dist/main.js"]
