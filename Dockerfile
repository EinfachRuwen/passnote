# ============================================================
# PassNote – Dockerfile
# Multi-stage Build: builder → runner
# Ziel: minimales Production-Image für ARM64 (Raspberry Pi 4)
# ============================================================

# ─────────────────────────────────────────────────────────────
# Stage 1: builder
# Kompiliert native Addons (better-sqlite3) mit Build-Tools
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Build-Tools für native Node-Addons (better-sqlite3 benötigt
# python3, make, g++ und sqlite-dev zur Kompilierung)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

WORKDIR /app

# Nur package.json kopieren, damit der Layer gecacht bleibt
# solange sich die Abhängigkeiten nicht ändern
COPY package.json package-lock.json* ./

# Production-Dependencies installieren und native Addons kompilieren
RUN npm install --omit=dev

# ─────────────────────────────────────────────────────────────
# Stage 2: runner
# Schlankes Production-Image ohne Build-Tools
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Nur Runtime-Bibliotheken, die better-sqlite3 zur Laufzeit braucht
RUN apk add --no-cache \
    sqlite-libs \
    libstdc++

WORKDIR /app

# Kompilierte node_modules aus dem builder-Stage übernehmen
COPY --from=builder /app/node_modules ./node_modules

# Anwendungscode kopieren
COPY src/ ./src/
COPY public/ ./public/

# Daten-Verzeichnis anlegen und dem unprivilegierten User "node"
# (bereits in node:alpine vorhanden, UID 1000) zuweisen
RUN mkdir -p /app/data && chown -R node:node /app/data

# Als Non-root-User ausführen (Security Best Practice)
USER node

# HTTP-Port der Anwendung
EXPOSE 3000

# Health-Check: prüft alle 30 s, ob der /health-Endpunkt antwortet
HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --retries=3 \
    --start-period=10s \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Anwendung starten (ES Modules, daher direkt node statt npm start)
CMD ["node", "src/server.js"]
