# ============================================================
# PassNote - Dockerfile
# Multi-stage Build: builder -> runner
# Ziel: minimales Production-Image fuer ARM64 (Raspberry Pi 4)
# ============================================================

# -------------------------------------------------------------
# Stage 1: builder
# Kompiliert native Addons (better-sqlite3) mit Build-Tools
# -------------------------------------------------------------
FROM node:22-alpine AS builder

# Build-Tools fuer native Node-Addons (better-sqlite3 benoetigt
# python3, make, g++ und sqlite-dev zur Kompilierung)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

WORKDIR /app

# Nur package.json kopieren, damit der Layer gecacht bleibt
# solange sich die Abhaengigkeiten nicht aendern
COPY package.json package-lock.json* ./

# Production-Dependencies installieren und native Addons kompilieren
RUN npm install --omit=dev

# -------------------------------------------------------------
# Stage 2: runner
# Schlankes Production-Image ohne Build-Tools
# -------------------------------------------------------------
FROM node:22-alpine AS runner

# Nur Runtime-Bibliotheken die better-sqlite3 zur Laufzeit braucht
RUN apk add --no-cache \
    sqlite-libs \
    libstdc++

WORKDIR /app

# Kompilierte node_modules aus dem builder-Stage uebernehmen
COPY --from=builder /app/node_modules ./node_modules

# Anwendungscode kopieren
COPY src/ ./src/
COPY public/ ./public/

# Daten-Verzeichnis anlegen - gehoert node-User (UID 1000)
# Named Volume wird beim ersten Start mit diesen Rechten initialisiert
RUN mkdir -p /app/data && chown -R node:node /app/data

# Als Non-root-User ausfuehren (Security Best Practice)
USER node

# HTTP-Port der Anwendung
EXPOSE 3000

# Health-Check: prueft alle 30s ob der /health-Endpunkt antwortet
HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --retries=3 \
    --start-period=10s \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Anwendung starten
CMD ["node", "src/server.js"]
