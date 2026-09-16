import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Manuelles Laden von .env falls vorhanden
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Entferne Quotes falls vorhanden
      if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
        value = value.replace(/(^"|"$)/g, '');
      }
      process.env[key] = value;
    }
  });
}

// Config Defaults
const PORT = parseInt(process.env.PORT || '3000');
const DB_PATH = process.env.DB_PATH || './data/passnote.db';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'passnote-admin';
const MAX_USERS_DEFAULT = parseInt(process.env.MAX_USERS_DEFAULT || '50');
const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(7 * 24 * 60 * 60 * 1000));

if (ADMIN_PASSWORD === 'passnote-admin') {
  console.warn('WARNUNG: Standard Admin-Passwort in Benutzung. Bitte in .env ändern!');
}

import { setupDatabase, updateCanvasData } from './db/queries.js';
import { startCleanupJob } from './jobs/cleanup.js';
import { createRoomsRouter } from './api/rooms.js';
import { createAdminRouter } from './api/admin.js';
import { setupWsHandler } from './ws/handler.js';

const app = express();

// Trust Proxy (für Cloudflare Tunnel / Cosmos Cloud)
// Verhindert ERR_ERL_UNEXPECTED_X_FORWARDED_FOR bei express-rate-limit
app.set('trust proxy', 1);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Global State
const db = setupDatabase(DB_PATH);
const activeRooms = new Map();

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"], // WebSockets erlauben
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"]
    },
  },
}));
app.use(compression());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 100, // 100 Requests pro IP
  standardHeaders: true,
  legacyHeaders: false,
});

// API Routes
app.use('/api', apiLimiter);
app.use('/api/rooms', createRoomsRouter(db, activeRooms));
app.use('/api/admin', createAdminRouter(db, activeRooms));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: activeRooms.size
  });
});

// Static Files - In production you would serve the built frontend here
app.use(express.static(path.join(__dirname, '../public')));

// WS Setup
setupWsHandler(wss, db, activeRooms);

// Cleanup Job
startCleanupJob(db, activeRooms);

// Graceful Shutdown
function gracefulShutdown() {
  console.log('Fahre Server herunter...');
  // Speichere alle aktiven Canvas-States
  for (const [slug, state] of activeRooms.entries()) {
    try {
      const room = db.prepare('SELECT id FROM rooms WHERE slug = ?').get(slug);
      if (room) {
        const data = JSON.stringify({ strokes: state.strokes, erased: Array.from(state.eraserStrokes) });
        updateCanvasData(db, room.id, data);
        console.log(`Canvas gesichert für: ${slug}`);
      }
    } catch (err) {
      console.error(`Fehler beim Sichern von ${slug}:`, err);
    }
  }
  
  db.close();
  server.close(() => {
    console.log('Server beendet.');
    process.exit(0);
  });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

server.listen(PORT, () => {
  console.log(`🚀 PassNote Server läuft auf Port ${PORT}`);
});
