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
# su-exec: sicherer User-Wechsel im Entrypoint (ersetzt gosu auf Alpine)
RUN apk add --no-cache \
    sqlite-libs \
    libstdc++ \
    su-exec

WORKDIR /app

# Kompilierte node_modules aus dem builder-Stage übernehmen
COPY --from=builder /app/node_modules ./node_modules

# Anwendungscode kopieren
COPY src/ ./src/
COPY public/ ./public/

# Daten-Verzeichnis anlegen und dem unprivilegierten User "node"
# (bereits in node:alpine vorhanden, UID 1000) zuweisen
RUN mkdir -p /app/data && chown -R node:node /app/data

# Entrypoint-Script für Permission-Fix bei Bind-Mounts
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# HTTP-Port der Anwendung
EXPOSE 3000

# Health-Check: prüft alle 30 s, ob der /health-Endpunkt antwortet
HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --retries=3 \
    --start-period=10s \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Entrypoint setzt Permissions und wechselt dann zu node-User
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
