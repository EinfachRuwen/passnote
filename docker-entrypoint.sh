#!/bin/sh
# Entrypoint-Script fuer PassNote
# Stellt sicher dass /app/data dem node-User gehoert,
# auch wenn Docker einen Bind-Mount als root einhaengt.

# Verzeichnis erstellen falls nicht vorhanden
mkdir -p /app/data

# Besitzer auf node-User setzen (UID 1000)
chown -R node:node /app/data

# Zu node-User wechseln und Hauptprozess starten
exec su-exec node "$@"
