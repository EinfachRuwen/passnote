import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getRoomBySlug } from '../db/queries.js';
import { parseNotes, saveRoomState, scheduleSave, MAX_NOTES } from './roomState.js';

const USER_COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D'];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CLIENT_ID_RE = /^[\w-]{8,64}$/;

const MAX_TEXT = 2000;
const MAX_STROKES = 2000;
const MAX_INK_NUMBERS = 60000;
const HEARTBEAT_MS = 30000;

export function setupWsHandler(wss, db, activeRooms) {
  // Tote Verbindungen (z.B. iPad im Standby) erkennen und aufräumen
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const url = new URL(req.url, 'http://localhost');
    const roomSlug = (url.searchParams.get('room') || '').trim().toLowerCase();

    if (!roomSlug || !getRoomBySlug(db, roomSlug)) {
      send(ws, { type: 'error', code: 'ROOM_NOT_FOUND' });
      ws.close(4004, 'Room not found');
      return;
    }

    let state = null;
    let client = null;
    let authPending = false;
    const recentNotes = [];
    let lastTyping = 0;

    const authTimeout = setTimeout(() => {
      if (!client) ws.close(4008, 'Auth timeout');
    }, 10000);

    ws.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'auth') {
        if (client || authPending) return;
        authPending = true;
        try {
          await authenticate(msg);
        } catch (err) {
          console.error('Auth Fehler:', err);
          ws.close(1011, 'Server error');
        }
        authPending = false;
        return;
      }

      if (!client) return;

      switch (msg.type) {
        case 'note':
          handleNote(msg);
          break;
        case 'delete':
          handleDelete(msg);
          break;
        case 'typing': {
          const now = Date.now();
          if (now - lastTyping < 1500) return;
          lastTyping = now;
          broadcast(state, { type: 'typing', userId: client.userId, username: client.username, color: client.color }, ws);
          break;
        }
        case 'ping':
          send(ws, { type: 'pong' });
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (!state || !state.clients.delete(ws)) return;
      broadcastUsers(state);
      if (state.clients.size === 0) {
        try {
          saveRoomState(db, state);
        } catch (err) {
          console.error('Fehler beim Speichern:', err);
        }
        if (activeRooms.get(roomSlug) === state) activeRooms.delete(roomSlug);
      }
    });

    async function authenticate(msg) {
      const room = getRoomBySlug(db, roomSlug);
      if (!room) {
        send(ws, { type: 'error', code: 'ROOM_NOT_FOUND' });
        ws.close(4004, 'Room not found');
        return;
      }

      if (room.password_hash) {
        const password = typeof msg.password === 'string' ? msg.password : '';
        const match = await bcrypt.compare(password, room.password_hash);
        if (!match) {
          send(ws, { type: 'error', code: 'WRONG_PASSWORD' });
          ws.close(4001, 'Wrong password');
          return;
        }
      }
      if (ws.readyState !== 1) return;

      const userId = typeof msg.clientId === 'string' && CLIENT_ID_RE.test(msg.clientId) ? msg.clientId : randomUUID();
      const username = (typeof msg.username === 'string' ? msg.username.trim() : '').slice(0, 20) || 'Anon';

      state = getOrCreateState(room);
      const others = new Set();
      for (const c of state.clients.values()) {
        if (c.userId !== userId) others.add(c.userId);
      }
      if (others.size >= room.max_users) {
        send(ws, { type: 'error', code: 'ROOM_FULL' });
        ws.close(4003, 'Room full');
        if (state.clients.size === 0 && activeRooms.get(roomSlug) === state) activeRooms.delete(roomSlug);
        state = null;
        return;
      }

      clearTimeout(authTimeout);
      client = { userId, username, color: colorFor(userId) };
      state.clients.set(ws, client);

      send(ws, {
        type: 'welcome',
        userId,
        color: client.color,
        users: getUsers(state),
        notes: state.notes
      });
      broadcastUsers(state, ws);
    }

    function handleNote(msg) {
      const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 64) : null;

      // Erneut gesendeter Zettel (z.B. nach Reconnect) – nur bestätigen
      if (cid) {
        const existing = state.notes.find(n => n.userId === client.userId && n.cid === cid);
        if (existing) {
          send(ws, { type: 'note', note: existing });
          return;
        }
      }

      const now = Date.now();
      while (recentNotes.length && now - recentNotes[0] > 5000) recentNotes.shift();
      if (recentNotes.length >= 10) return;
      recentNotes.push(now);

      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_TEXT) : '';
      const ink = sanitizeInk(msg.ink);
      if (!text && !ink) return;

      const note = {
        id: randomUUID(),
        cid,
        userId: client.userId,
        username: client.username,
        color: client.color,
        ts: now
      };
      if (text) note.text = text;
      if (ink) note.ink = ink;

      state.notes.push(note);
      if (state.notes.length > MAX_NOTES) state.notes.splice(0, state.notes.length - MAX_NOTES);

      broadcast(state, { type: 'note', note });
      scheduleSave(db, state);
    }

    function handleDelete(msg) {
      const idx = state.notes.findIndex(n => n.id === msg.id && n.userId === client.userId);
      if (idx === -1) return;
      state.notes.splice(idx, 1);
      broadcast(state, { type: 'deleted', id: msg.id });
      scheduleSave(db, state);
    }
  });

  function getOrCreateState(room) {
    let state = activeRooms.get(room.slug);
    if (!state) {
      state = {
        roomId: room.id,
        clients: new Map(),
        notes: parseNotes(room.canvas_data),
        saveTimer: null
      };
      activeRooms.set(room.slug, state);
    }
    return state;
  }
}

function sanitizeInk(ink) {
  if (!ink || typeof ink !== 'object' || !Array.isArray(ink.strokes)) return null;
  const w = clampNum(ink.w, 0.01, 1.5);
  const h = clampNum(ink.h, 0.01, 5);
  if (w === null || h === null) return null;

  let budget = MAX_INK_NUMBERS;
  const strokes = [];
  for (const s of ink.strokes.slice(0, MAX_STROKES)) {
    if (!s || !Array.isArray(s.p) || s.p.length < 3) continue;
    const size = clampNum(s.s, 0.0005, 0.05);
    if (size === null) continue;
    const len = Math.min(s.p.length - (s.p.length % 3), budget - (budget % 3));
    if (len < 3) break;
    const p = new Array(len);
    for (let i = 0; i < len; i++) {
      const n = s.p[i];
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      p[i] = n;
    }
    budget -= len;
    strokes.push({ c: COLOR_RE.test(s.c) ? s.c : '#1F2A44', s: size, p });
  }
  return strokes.length ? { w, h, strokes } : null;
}

function clampNum(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

function colorFor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

function getUsers(state) {
  const users = new Map();
  for (const c of state.clients.values()) {
    users.set(c.userId, { userId: c.userId, username: c.username, color: c.color });
  }
  return [...users.values()];
}

function broadcastUsers(state, excludeWs = null) {
  broadcast(state, { type: 'users', users: getUsers(state) }, excludeWs);
}

function broadcast(state, msg, excludeWs = null) {
  const data = JSON.stringify(msg);
  for (const ws of state.clients.keys()) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
