# ITDock - Production Dockerfile
# Multi-stage build for optimized image size

FROM node:20.19-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN \
  if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  else npm install; \
  fi

# Build the application
FROM base AS builder
WORKDIR /app

# Build-time env vars needed to satisfy module-level checks
ARG MONGO_URL=mongodb://mongo:27017
ARG DB_NAME=itdock
ENV MONGO_URL=$MONGO_URL
ENV DB_NAME=$DB_NAME

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Build Next.js application
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

# Set to production environment
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

# Create upload directories with proper permissions
RUN mkdir -p /app/uploads/asset-docs \
    && mkdir -p /app/uploads/custody \
    && mkdir -p /app/uploads/audit \
    && chown -R nextjs:nodejs /app/uploads \
    && chmod -R 750 /app/uploads

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set environment variable for port
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {let data = ''; r.on('data', (c) => data += c); r.on('end', () => {const j = JSON.parse(data); process.exit(j.ok && j.db === 'connected' ? 0 : 1);}); }).on('error', () => process.exit(1));"

# Start the application
CMD ["npm", "start"]
