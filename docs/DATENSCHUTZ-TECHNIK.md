# PassNote – Technische Datenschutzdokumentation

Stand: 18. November 2026 · gehört zu `public/datenschutz.html` (Route `/datenschutz`)

Diese Datei hält fest, welche personenbezogenen Daten PassNote verarbeitet, wo das im Code passiert und
was davon belegt ist. Sie ist die Grundlage der öffentlichen Datenschutzerklärung. Zeilennummern beziehen
sich auf den Stand dieses Commits.

**Status-Legende**
- **belegt** – im Code/Repo nachweisbar
- **bisherige Erklärung** – nicht im Repo belegbar, aus der bisherigen Erklärung (focusonruwen.com/datenschutz, Stand 15.11.2026) übernommen
- **offen** – weder im Repo noch in der bisherigen Erklärung belegbar; muss der Betreiber klären

## 1. Architektur in Kürze

| Komponente | Fundstelle | Status |
|---|---|---|
| Node.js/Express-Server + WebSocket (`ws`) auf Port 3000 | `src/server.js:48-55`, `package.json:11-21` | belegt |
| SQLite-Datenbank (`better-sqlite3`), Datei `DB_PATH` (Standard `./data/passnote.db`, Docker: `/app/data/passnote.db` im Volume `passnote_data`) | `src/db/queries.js:5-26`, `docker-compose.yml:23-30,56-57` | belegt |
| Betrieb als Docker-Container, gedacht für Raspberry Pi 4 (ARM64) | `Dockerfile:4`, `docker-compose.yml:38` | belegt (Konfiguration); Betrieb auf „eigenem Server“: bisherige Erklärung |
| Erreichbarkeit über Cloudflare Tunnel (`cloudflared`) | `README.md:69-92`, `src/server.js:50-52` („Cloudflare Tunnel / Cosmos Cloud“) | Anleitung belegt; tatsächliche Nutzung unter passnote.fcrw.cc: bisherige Erklärung |
| Container-Image über GitHub Actions → ghcr.io | `.github/workflows/docker.yml` | belegt (betrifft keine Besucherdaten) |

## 2. Verarbeitungen

| # | Verarbeitung | Fundstelle | Datenkategorien | Empfänger | Speicherort / -dauer | Rechtsgrundlage | Status |
|---|---|---|---|---|---|---|---|
| 1 | Block anlegen (Startseite) | `public/assets/start.js:88-111`, `src/api/rooms.js:12-34`, `src/db/queries.js:38-46`, `src/db/schema.sql:1-11` | zufälliger Code (Slug, z. B. `calm-moon-42`, `src/utils/slug.js:13-18`), UUID, Typ `temporary`, optional Passwort-Hash, `max_users`, `created_at`, `last_active_at` | – | SQLite `rooms`; bis zur Löschung (Nr. 6) | Art. 6 Abs. 1 lit. b | belegt |
| 2 | Block-Passwort | `src/api/rooms.js:14-15` (bcryptjs, Kostenfaktor 10, max. 100 Zeichen), `src/api/admin.js:72-75`, Prüfung `src/ws/handler.js:118-126` (`bcrypt.compare`) | Passwort → nur bcrypt-Hash in `rooms.password_hash`; lokal getestet: Hash beginnt mit `$2a$10$` | – | SQLite; Klartext nur flüchtig im Request/WS-Auth | lit. b | belegt – „nur als Hash“ stimmt |
| 3 | Beitreten (WebSocket `/ws?room=<Code>`) | `src/server.js:55`, `public/assets/board.js:470-480`, `src/ws/handler.js:29-157` | Code, Anzeigename (getrimmt, max. 20 Zeichen, sonst „Anon“, `handler.js:130`), Client-ID aus localStorage (`handler.js:129`), Passwort (nur zur Prüfung), Farbe (aus Client-ID abgeleitet, `handler.js:253-257`) | alle verbundenen Teilnehmer des Blocks (Teilnehmerliste `handler.js:156,259-269`, „… schreibt“ `handler.js:83-89`) | Arbeitsspeicher (`activeRooms`) solange verbunden | lit. b | belegt |
| 4 | Zettel schreiben | `public/assets/board.js:950-966`, `src/ws/handler.js:159-196`, `src/ws/roomState.js:300-317` | Text (max. 2000 Zeichen), Handschrift-Strichdaten (`sanitizeInk`, `handler.js:222-246`), Anzeigename, Client-ID, Farbe, Zeitstempel, Client-Nonce `cid` | alle aktuellen und künftigen Besucher des Blocks | SQLite `rooms.canvas_data` (JSON, Klartext); max. 150 neueste Zettel pro Block, ältere werden verworfen (`roomState.js:4`, `handler.js:192`) | lit. b | belegt |
| 5 | Eigene Zettel wegwerfen | `src/ws/handler.js:198-204` | – | Teilnehmer erhalten `deleted` | entfernt aus `canvas_data` beim nächsten Speichern (≤ 2 s) | lit. b | belegt |
| 6 | Automatische Löschung | `src/jobs/cleanup.js:4-37`, `src/db/queries.js:58-72`, `src/server.js:35,120` | ganze Zeile in `rooms` inkl. aller Zettel | – | `DELETE` wenn `type = 'temporary'` und `last_active_at` älter als `ROOM_TTL_MS` (Standard 7 Tage); Cron stündlich (`0 * * * *`) | – | belegt, mit Abweichungen (s. Abschnitt 4) |
| 7 | Admin-Bereich `/admin.html`, `/api/admin/*` | `src/api/admin.js`, `public/assets/admin.js` | Admin-Passwort (Klartextvergleich mit ENV), Admin-Token (UUID, im Server-RAM ohne Ablauf; im Browser `sessionStorage.admin_token`) | nur Betreiber | Admin kann alle Blöcke listen, **alle Zettel lesen** (`GET /rooms/:id/canvas`, `admin.js:120-134`), leeren, löschen, dauerhafte Blöcke anlegen (`admin.js:58-95`, `admin.html:261-265`) | lit. f (Betrieb/Missbrauchsabwehr) | belegt |
| 8 | Rate-Limiting `/api/*` | `src/server.js:76-84`, `trust proxy 1` `src/server.js:52` | Client-IP (aus `X-Forwarded-For` des Proxys) als Schlüssel im MemoryStore von `express-rate-limit` | – | Arbeitsspeicher, Fenster 15 min, max. 300 Anfragen; weg bei Neustart | lit. f | belegt |
| 9 | Server-/Container-Logs | `console.*` in `src/server.js:38,145`, `src/jobs/cleanup.js:11,27,30,32,36`, `src/ws/handler.js:67,104`, `src/api/*`; `docker-compose.yml:47-52` | keine Request-Logs, keine IPs; Cleanup loggt Block-Code + UUID gelöschter Blöcke; Fehlerobjekte | – | Docker `json-file`, 3 × 10 MB rotierend (größen-, nicht zeitbasiert) | lit. f | belegt |
| 10 | Cloudflare (Tunnel/Proxy, TLS-Terminierung) | `README.md:69-92,204-207` | IP, Zeitpunkt, URL (inkl. `?room=<Code>`), User-Agent, durchgeleitete Inhalte (Zettel, WS-Auth inkl. Passwort) | Cloudflare Inc., 101 Townsend St, San Francisco, CA 94107, USA – EU-US-DPF-zertifiziert (https://www.cloudflare.com/privacypolicy/, Abschnitt 7, abgerufen 18.11.2026) | nach Cloudflare-Richtlinien | lit. f; Art. 45 | Einsatz: bisherige Erklärung + README; Konfiguration (Tunnel-Config, Log-Einstellungen, AVV/DPA) **offen** |
| 11 | QR-Code zum Einladen | `src/api/rooms.js:58-87` (Paket `qrcode`, lokal) | Board-URL mit Code | – | nicht gespeichert, 1 h HTTP-Cache | lit. b | belegt – kein externer Dienst |
| 12 | Raum-Info | `src/api/rooms.js:36-56` | gibt ohne Anmeldung `exists`, `hasPassword`, `userCount` zurück | jeder, der den Code kennt | – | lit. b | belegt |
| 13 | Health-Endpunkt | `src/server.js:89-95` | Uptime, Anzahl aktiver Räume (keine personenbezogenen Daten) | öffentlich | – | – | belegt |
| 14 | Zwischenablage | `public/assets/board.js:979-991` | Block-Link, nur auf Klick | – | – | – | belegt |

## 3. Browser-Speicher (keine Cookies)

Es wird **kein Cookie** gesetzt (kein `document.cookie`, kein `Set-Cookie` im Server; lokal geprüft).
Alles unten ist für die vom Nutzer gewünschte Funktion erforderlich → § 25 Abs. 2 Nr. 2 TDDDG.

| Speicher | Schlüssel | Inhalt / Zweck | Dauer | Fundstelle |
|---|---|---|---|---|
| localStorage | `passnote_username` | Anzeigename | unbegrenzt | `start.js:16-21`, `board.js:40,59,998,1015` |
| localStorage | `passnote_client_id` | zufällige UUID; Zuordnung eigener Zettel, Löschrecht, Duplikatschutz | unbegrenzt | `board.js:41,54-58` |
| localStorage | `passnote_recent` | bis zu 6 zuletzt genutzte Block-Codes | unbegrenzt; Eintrag entfernt, wenn Block weg | `start.js:114-131`, `board.js:629-640` |
| localStorage | `passnote_outbox_<Code>` | noch nicht zugestellte Zettel (Offline-Warteschlange) | bis Zustellung / Block weg | `board.js:62-69,608` |
| localStorage | `passnote_subject_<Code>` | Fach-Überschrift (nur lokal) | unbegrenzt | `board.js:92-95` |
| localStorage | `passnote_cover_title`, `passnote_cover_text` | Tarn-Heft (nur lokal, nie übertragen) | unbegrenzt | `board.js:1041-1044` |
| localStorage | `passnote_cover_hints` | Zähler für Hinweis | unbegrenzt | `board.js:1053-1056` |
| sessionStorage | `passnote_pw_<Code>` | Block-Passwort **im Klartext** für Auto-Reconnect | bis Tab geschlossen | `start.js:38`, `board.js:47-52,71-72` |
| sessionStorage | `admin_token` | Admin-Sitzung (nur Betreiber) | bis Tab geschlossen / Logout | `admin.js:8,30,40` |
| Service Worker + Cache Storage | `/sw.js`, Cache `passnote-v4` | App-Shell + erfolgreich geladene Same-Origin-GETs (nicht `/api/`, nicht `/ws`) als Offline-Fallback; keine Zettel | bis neuer Cache-Name / Löschen der Website-Daten | `public/sw.js:1-45`, Registrierung `start.js:133-135`, `board.js:1109-1111` |

## 4. Abgleich mit der bisherigen Erklärung (Abschnitt 10 „Passnote“ und 3 „Hosting“)

| Aussage der bisherigen Erklärung | Ergebnis am Code |
|---|---|
| „speichert die Zettel eines Blocks einschließlich des Anzeigenamens“ | **stimmt**, aber unvollständig: zusätzlich Client-ID, Farbe, Zeitstempel, Handschrift-Strichdaten je Zettel (Nr. 4); Name wird auch live an andere Teilnehmer gesendet. |
| „Passwörter von Blöcken werden nur als Hash gespeichert“ | **stimmt** (bcrypt, Kosten 10). Hinweise: Im Browser liegt das Passwort für die Sitzung im Klartext in `sessionStorage` (`passnote_pw_<Code>`); `board.html?password=…` wird akzeptiert (`board.js:47-52`) – ein solcher Link landet vor dem `replaceState` in Cloudflare-Logs und ggf. im Browserverlauf. Kein Code im Repo erzeugt solche Links. |
| „Blöcke, die sieben Tage nicht benutzt wurden, werden automatisch gelöscht“ | **im Grundsatz stimmt es**, mit Abweichungen: (a) gilt nur für `type = 'temporary'` (`queries.js:70`); Admin kann **„permanent“-Blöcke** anlegen, die nie automatisch gelöscht werden (`admin.html:263-264`, `admin.js:59`). Öffentlich angelegte Blöcke sind immer `temporary` (`rooms.js:24`). (b) Prüfung **stündlich** (`cleanup.js:8`); die Variable `CLEANUP_INTERVAL_HOURS` (`.env.example:18`, `docker-compose.yml:34`, README) wird **nirgends ausgewertet**. Tatsächliche Löschung also 7 Tage bis 7 Tage + ~1 h nach letzter Aktivität. (c) Blöcke mit verbundenen Nutzern werden übersprungen (`cleanup.js:17-19`). (d) „Benutzung“ = `last_active_at` wird gesetzt beim Speichern (Zettel schreiben/wegwerfen, `queries.js:48-51`) und beim Verlassen des letzten Teilnehmers (`handler.js:96-107`) – also zählt jeder Besuch, nicht aber `/info`- oder QR-Aufrufe. (e) `DELETE` ohne `PRAGMA secure_delete`/`VACUUM`: Inhalte können bis zum Überschreiben als freie Seiten in der DB-Datei verbleiben. (f) Backups: `docker-compose.yml:9-11` beschreibt manuelle Volume-Backups – ob welche existieren und wie lange sie liegen, ist **offen**. |
| „läuft auf meinem eigenen Server“ | Repo konsistent (Docker auf Raspberry Pi 4, `Dockerfile:4`). Standort des Servers: **offen** (nicht in Repo oder bisheriger Erklärung). Kommentar `server.js:50` erwähnt „Cosmos Cloud“ – falls ein zusätzlicher Reverse-Proxy (Cosmos) mit eigenen Zugriffslogs läuft: **offen**. |
| „Verbindung über Cloudflare … verarbeitet technische Verbindungsdaten“ | Belegt über README (Tunnel). **Ergänzt:** Cloudflare terminiert TLS, d. h. Inhalte (Zettel, WS-Passwortprüfung) passieren Cloudflare entschlüsselt. `docker-compose.yml:20-22` veröffentlicht Port 3000 auf dem Host – ob er von außen erreichbar ist (Umgehung von Cloudflare), ist **offen**. |
| „Die Logs werden vom jeweiligen Anbieter nach kurzer Zeit gelöscht“ | Eigene App: keine Zugriffslogs (belegt). Container-Logs größenbasiert rotiert (3 × 10 MB), keine feste Frist. Cloudflare-Logaufbewahrung: **offen** / Cloudflare-Richtlinien. |
| „keine Umami-Statistik“ (Abschnitt 5) | **stimmt**: kein Analytics-Code; CSP erlaubt nur `'self'` (`server.js:62-72`); keine externen Fonts/CDNs/Bilder (Systemschriften, `zettel.css:12-13`; Icons/Manifest-Icon als Inline-SVG/Data-URI). |
| Rechtsgrundlage Art. 6 Abs. 1 lit. b | übernommen; für Cloudflare, Rate-Limit, Logs ergänzt lit. f. |

## 5. Offene Punkte (nur durch den Betreiber zu klären)

1. Gibt es aktuell „permanent“-Blöcke? Falls nein und nicht geplant: Option im Admin-Bereich entfernen oder Erklärung so lassen (sie erwähnt die Ausnahme bereits).
2. Backups des Volumes `passnote_data`: ob, wo und wie lange? Ggf. in Erklärung ergänzen.
3. Standort des eigenen Servers (Deutschland/EU?) und ob neben `cloudflared` ein weiterer Reverse-Proxy (z. B. Cosmos Cloud) mit Zugriffslogs läuft.
4. Ist Port 3000 nur lokal erreichbar (Firewall/`127.0.0.1:3000:3000`)?
5. Cloudflare: Data Processing Addendum akzeptiert (Self-Serve-Vertrag)? Logpush/Analytics-Einstellungen für die Zone?
6. Zielgruppe Schüler, oft minderjährig: Tragfähigkeit von Art. 6 Abs. 1 lit. b bei Minderjährigen ggf. rechtlich prüfen lassen.
7. Die Sammelerklärung auf focusonruwen.com/datenschutz nennt Passnote weiterhin (Abschnitte 1, 3, 10) – dort auf die neue Seite verweisen oder Passnote entfernen.

## 6. Empfehlungen (nicht umgesetzt, Codeänderung nötig)

- `PRAGMA secure_delete = ON` in `setupDatabase` (`src/db/queries.js`), damit gelöschte Blöcke physisch überschrieben werden.
- `CLEANUP_INTERVAL_HOURS` entweder auswerten oder aus `.env.example`, `docker-compose.yml` und README entfernen.
- `?password=`-Parameter in `board.js` entfernen, falls nicht genutzt.
- Port-Mapping auf `127.0.0.1:3000:3000` beschränken, wenn nur der Tunnel zugreifen soll.
