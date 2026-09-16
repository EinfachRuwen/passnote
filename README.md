```
██████╗  █████╗ ███████╗███████╗███╗   ██╗ ██████╗ ████████╗███████╗
██╔══██╗██╔══██╗██╔════╝██╔════╝████╗  ██║██╔═══██╗╚══██╔══╝██╔════╝
██████╔╝███████║███████╗███████╗██╔██╗ ██║██║   ██║   ██║   █████╗
██╔═══╝ ██╔══██║╚════██║╚════██║██║╚██╗██║██║   ██║   ██║   ██╔══╝
██║     ██║  ██║███████║███████║██║ ╚████║╚██████╔╝   ██║   ███████╗
╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝ ╚═════╝    ╚═╝   ╚══════╝
```

> 🔐 Sicheres, selbst gehostetes Echtzeit-Notizsystem mit Passwortschutz

[![Build & Push Docker Image](https://github.com/DEIN_GITHUB_USER/passnote/actions/workflows/docker.yml/badge.svg)](https://github.com/DEIN_GITHUB_USER/passnote/actions/workflows/docker.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/DEIN_GITHUB_USER/passnote)](https://ghcr.io/DEIN_GITHUB_USER/passnote)

---

## ✨ Features

- 📝 **Echtzeit-Kollaboration** via WebSocket – Änderungen sofort für alle sichtbar
- 🔒 **Passwortgeschützte Räume** – jeder Raum mit eigenem Zugangscode
- 🗄️ **SQLite-Datenbank** – keine externe Datenbank nötig, alles in einer Datei
- 🐳 **Docker-Ready** – ein Befehl zum Starten
- 🍓 **Raspberry Pi 4 optimiert** – ARM64-Image, minimaler Ressourcenverbrauch
- ☁️ **Cloudflare Tunnel kompatibel** – sicherer HTTPS-Zugang ohne offene Ports
- 🛡️ **Admin-Panel** – Räume verwalten, Benutzer überwachen
- 🔄 **Automatischer Cleanup** – inaktive Räume werden nach TTL gelöscht

---

## 🚀 Schnellstart

### Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) ≥ 2.20 (Plugin, kein separates Binary)

### 5 Schritte zum laufenden System

**1. Repository klonen**
```bash
git clone https://github.com/DEIN_GITHUB_USER/passnote.git
cd passnote
```

**2. Umgebungsvariablen konfigurieren**
```bash
cp .env.example .env
nano .env   # ADMIN_PASSWORD unbedingt ändern!
```

**3. Image pullen**
```bash
docker compose pull
```

**4. Container starten**
```bash
docker compose up -d
```

**5. Browser öffnen**
```
http://localhost:3000
```

---

## ☁️ Cloudflare Tunnel Setup

Mit Cloudflare Tunnel ist PassNote über HTTPS erreichbar, ohne Ports in der Firewall öffnen zu müssen.

```bash
# 1. cloudflared auf dem Raspberry Pi installieren
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 2. Tunnel einrichten (einmalig)
cloudflared tunnel login
cloudflared tunnel create passnote
cloudflared tunnel route dns passnote notes.deine-domain.de

# 3. Tunnel starten (zeigt auf localhost:3000)
cloudflared tunnel run --url http://localhost:3000 passnote
```

> **Tipp:** `cloudflared` als systemd-Service einrichten, damit es nach Neustarts automatisch läuft:
> ```bash
> cloudflared service install
> systemctl enable --now cloudflared
> ```

---

## 🛡️ Admin-Panel

Das Admin-Panel ist unter `/admin` erreichbar:

```
http://localhost:3000/admin
```

**Zugangsdaten:** Das in `.env` gesetzte `ADMIN_PASSWORD`.

**Funktionen:**
- Alle aktiven Räume anzeigen (Name, Nutzeranzahl, letzte Aktivität)
- Räume manuell löschen
- Systemstatistiken einsehen (RAM, Uptime, Verbindungen)
- Cleanup manuell auslösen

---

## ⚙️ Umgebungsvariablen

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port des Express-Servers |
| `ADMIN_PASSWORD` | – | Passwort für das Admin-Panel (**Pflicht!**) |
| `DB_PATH` | `./data/passnote.db` | Pfad zur SQLite-Datenbankdatei |
| `MAX_USERS_DEFAULT` | `50` | Max. gleichzeitige Benutzer pro Raum |
| `CLEANUP_INTERVAL_HOURS` | `24` | Cleanup-Intervall in Stunden |
| `ROOM_TTL_MS` | `604800000` | Raum-Lebensdauer in ms (Standard: 7 Tage) |

Alle Variablen werden in `.env` gesetzt (Vorlage: `.env.example`).

---

## 🏗️ Eigenes Docker-Image bauen

Das CI/CD-System baut automatisch bei jedem Push ein neues Image.

**1. Repository forken**

Klicke auf GitHub oben rechts auf **Fork**.

**2. GitHub Actions baut automatisch**

Bei jedem Push auf `main` oder bei einem versionierten Tag (z.B. `git tag v1.0.0 && git push --tags`) startet der Workflow automatisch und baut Images für `linux/arm64` und `linux/amd64`.

**3. Image auf ghcr.io verfügbar**

Das fertige Image steht unter:
```
ghcr.io/DEIN_GITHUB_USER/passnote:latest
```

**4. Image in docker-compose.yml anpassen**

```yaml
image: ghcr.io/DEIN_GITHUB_USER/passnote:latest
#       ↑ eigenen GitHub-Usernamen eintragen
```

**Lokal bauen (ohne CI/CD):**
```bash
docker build -t passnote:local .
# docker-compose.yml: image: passnote:local
```

---

## 📊 Ressourcenverbrauch

Gemessen auf einem **Raspberry Pi 4 (4 GB RAM)**:

| Zustand | RAM | CPU |
|---|---|---|
| Idle (keine Verbindungen) | ~50 MB | < 1% |
| 10 aktive Nutzer | ~70 MB | 2–5% |
| 50 aktive Nutzer | ~100 MB | 10–20% |

Das Docker-Compose-Limit ist auf **256 MB RAM** und **0,5 CPU-Kerne** gesetzt – ausreichend für Heimserver-Betrieb.

---

## 🔧 Troubleshooting

### Container startet nicht

```bash
docker compose logs app
```

Häufige Ursachen:
- `.env` fehlt → `cp .env.example .env`
- `ADMIN_PASSWORD` nicht gesetzt → in `.env` eintragen
- Port 3000 belegt → `lsof -i :3000` und Prozess beenden

### Datenbank-Fehler (Permission Denied)

Das `data/`-Verzeichnis muss dem Container-User (`UID 1000`) gehören:

```bash
sudo chown -R 1000:1000 ./data
docker compose restart
```

### Image kann nicht gepullt werden (ghcr.io)

Bei privaten Repositories muss das Image erst öffentlich gestellt werden:
- GitHub → Packages → passnote → Package settings → **Make public**

### WebSocket-Verbindungen über Cloudflare schlagen fehl

Stelle sicher, dass in den Cloudflare-Einstellungen für die Domain **WebSockets aktiviert** sind:
- Cloudflare Dashboard → Network → **WebSockets: On**

### Health-Check schlägt fehl

Prüfen, ob der `/health`-Endpunkt in `src/server.js` definiert ist:
```javascript
app.get('/health', (req, res) => res.sendStatus(200));
```

---

## 📄 Lizenz

MIT © DEIN_GITHUB_USER
