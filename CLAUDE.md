# CLAUDE.md – Hinweise für Arbeiten an PassNote

## Datenschutz (verbindlich)

Bei **jeder datenschutzrelevanten Codeänderung** – z. B. neue Dienste oder externe Requests (fetch/XHR/WebSocket, CDNs, Fonts), neue oder geänderte Cookies, localStorage/sessionStorage-Schlüssel, Service-Worker-Caches, Analytics, neue Datenfelder in DB oder Zetteln, geänderte Speicher-/Löschfristen (`ROOM_TTL_MS`, Cleanup-Job), Logging, Hosting/Proxy (Cloudflare, Server) – müssen im selben Change geprüft und aktualisiert werden:

1. `public/datenschutz.html` (öffentliche Datenschutzerklärung, Route `/datenschutz`) inkl. **Stand-Datum**
2. `docs/DATENSCHUTZ-TECHNIK.md` (technische Doku mit Fundstellen) inkl. **Stand-Datum**

Keine externen Ressourcen einbinden, ohne beides anzupassen. Die CSP in `src/server.js` erlaubt bewusst nur `'self'`.
