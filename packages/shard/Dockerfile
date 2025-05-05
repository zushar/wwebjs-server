# Dockerfile for the shard service in the WhatsApp Cluster project
# ==== Build Stage ====
FROM node:22-alpine AS builder

# Install pnpm and build dependencies
RUN npm install -g pnpm
RUN apk add --no-cache curl python3 make g++

# Install Chromium and dependencies for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# Set environment variable to tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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

# Install runtime dependencies and Chromium
RUN apk add --no-cache \
    curl \
    netcat-openbsd \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
    dumb-init \
    # נוסיף ספריות שחסרות
    libevent \
    xvfb \
    libxshmfence

# Add a non-root user to run Chrome
RUN adduser -D -h /home/pptruser pptruser

# Set environment variable to tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    HOME=/home/pptruser \
    SESSIONS_PATH=/tmp/sessions

# Set the working directory
WORKDIR /usr/src/app

# Create necessary directories with proper permissions - UPDATED THIS PART
RUN mkdir -p proto /tmp/sessions && \
    chmod 1777 /tmp/sessions

# Copy package files with ownership in a single layer
COPY --from=builder --chown=pptruser:pptruser \
     /usr/src/app/package.json \
     /usr/src/app/pnpm-lock.yaml \
     /usr/src/app/pnpm-workspace.yaml ./

# Create required directories with proper ownership
RUN mkdir -p packages/shard packages/shared-lib && \
    chown -R pptruser:pptruser packages

# Copy package files to subdirectories
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shard/package.json ./packages/shard/
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shared-lib/package.json ./packages/shared-lib/

# Copy the node_modules from the builder stage (these take the most time)
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shard/node_modules ./packages/shard/node_modules
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shared-lib/node_modules ./packages/shared-lib/node_modules

# Copy the built application code
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shard/dist ./packages/shard/dist
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/shared-lib/dist ./packages/shared-lib/dist

# Copy proto files needed by NestJS gRPC at runtime
COPY --from=builder --chown=pptruser:pptruser /usr/src/app/packages/proto/whatsapp_shard.proto ./proto/

# Make main.js executable
RUN chmod 755 packages/shard/dist/main.js

# Switch to the non-root user
USER pptruser

# Expose the gRPC port
EXPOSE 50051

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Define the command to run the application
CMD ["node", "packages/shard/dist/main.js"]