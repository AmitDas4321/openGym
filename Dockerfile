# ==============================================================================
# Stage 1: Build Frontend (Vite) & Backend Bundle (esbuild)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci 2>/dev/null || npm install

# Copy source code and configuration files
COPY . .

# Ensure media directory exists in builder so COPY in runner stage succeeds even if media is initially empty
RUN mkdir -p /app/media /app/data

# Build Vite frontend assets and bundle backend server into /app/dist
RUN npm run build

# ==============================================================================
# Stage 2: Production Minimal Runtime
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment defaults
ENV NODE_ENV=production \
    PORT=3000

# Copy dependency manifests and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Copy compiled frontend and backend bundles from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend dependencies, services, and static assets
COPY server.js ./
COPY database ./database
COPY scripts ./scripts
COPY public ./public

# Copy media and data directories directly from builder stage into the production container
COPY --from=builder /app/media ./media
COPY --from=builder /app/data ./data

# Ensure proper permissions for non-root user
RUN chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose unified application port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Start the unified production server
CMD ["node", "dist/server.cjs"]
