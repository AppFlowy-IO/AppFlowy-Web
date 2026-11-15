# syntax=docker/dockerfile:1
# Build stage
FROM node:20.12.0-alpine AS builder

ARG VERSION

# Set production environment
ENV NODE_ENV=production

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Enable corepack and install dependencies
RUN corepack enable && \
    pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Optional Google Drive Picker settings. .dockerignore keeps .env files out of
# the build, so pass these as build args; unset, the build uses its defaults.
ARG APPFLOWY_GOOGLE_DRIVE_PICKER_APP_ID
ARG APPFLOWY_GOOGLE_DRIVE_PICKER_API_KEY

# Match the CI web build's heap budget for the full application graph.
RUN NODE_OPTIONS="--max-old-space-size=8192" APPFLOWY_WEB_VERSION="${VERSION}" pnpm run build

# Production stage
FROM nginx:1.25-alpine

# Install runtime dependencies
RUN apk add --no-cache tini

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html/

# Copy configuration files
COPY --from=builder /app/docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/docker/entrypoint.sh /docker-entrypoint.sh

# Make entrypoint executable
RUN chmod +x /docker-entrypoint.sh


# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]
