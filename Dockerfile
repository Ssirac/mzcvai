# ── MZ Talent Intelligence — production image ────────────────────────────────
FROM node:22-bookworm-slim

# System Chromium for Puppeteer (CV PDFs + employer enrichment) + its libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates fonts-liberation \
    libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
    libgtk-3-0 libasound2 libxcomposite1 libxdamage1 libxrandr2 libxkbcommon0 \
    libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Use the system Chromium; don't download Puppeteer's own copy
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Install ALL deps (including devDependencies needed for next build / tailwindcss)
COPY package.json package-lock.json* ./
RUN npm install --include=dev

# Build
COPY . .
RUN npx prisma generate && npm run build

# Switch to production mode after build is complete
ENV NODE_ENV=production

EXPOSE 3000

# Sync the DB schema, then start. `next start` listens on $PORT (Railway sets it).
CMD ["sh", "-c", "npx prisma db push && npx next start -p ${PORT:-3000}"]
