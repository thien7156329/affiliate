# ==========================================
# Stage 1: Build React Frontend (client/dist)
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client/ ./
RUN npm run build

# ==========================================
# Stage 2: Build Backend TypeScript (build/)
# ==========================================
FROM node:20-bookworm-slim AS backend-builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# ==========================================
# Stage 3: Production Runtime
# ==========================================
FROM node:20-bookworm-slim AS runner

# Install FFmpeg, Chromium for Puppeteer, fonts & dumb-init
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-freefont-ttf \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    libasound2 \
    libatk1.0-0 \
    libcups2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libnss3 \
    libxss1 \
    dumb-init \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3400

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled backend
COPY --from=backend-builder /app/build ./build

# Copy compiled frontend into client/dist (served directly by Express)
COPY --from=frontend-builder /app/client/dist ./client/dist

# Copy public folder (fallback assets)
COPY public/ ./public/

# Ensure data folder exists
RUN mkdir -p /app/data/downloads /app/data/temp

EXPOSE 3400

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "build/server.js"]
