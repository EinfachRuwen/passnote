import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getAllRooms, getRoomById, createRoom, deleteRoom, updateCanvasData } from '../db/queries.js';
import { generateSlug, isValidSlug } from '../utils/slug.js';

const activeAdminTokens = new Set();

export function createAdminRouter(db, activeRooms) {
  const router = Router();
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'passnote-admin';

  router.post('/login', (req, res) => {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    // Für das ADMIN_PASSWORD gibt es idR keinen Hash, da es direkt in der env steht
    if (password === ADMIN_PASSWORD) {
      const token = uuidv4();
      activeAdminTokens.add(token);
      return res.json({ token });
    }

    return res.status(401).json({ error: 'Invalid password' });
  });

  // Middleware für alle folgenden Routen
  router.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!activeAdminTokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
  });

  router.get('/rooms', (req, res) => {
    const rooms = getAllRooms(db);
    const result = rooms.map(room => {
      const activeState = activeRooms.get(room.slug);
      return {
        ...room,
        activeUsers: activeState ? activeState.clients.size : 0
      };
    });
    res.json(result);
  });

  router.post('/rooms', async (req, res) => {
    const { name, type = 'temporary', password, maxUsers } = req.body;
    let { slug } = req.body;

    if (slug && !isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    if (!slug) {
      slug = generateSlug();
      // Collisions check (sehr unwahrscheinlich aber möglich)
      // Wir überspringen das für simplicity oder machen einen retry in Prod
    }

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const roomId = uuidv4();
    try {
      const room = createRoom(db, {
        id: roomId,
        slug,
        name: name || null,
        type,
        passwordHash,
        maxUsers: maxUsers || parseInt(process.env.MAX_USERS_DEFAULT || '50')
      });
      res.json({ room });
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Slug already exists' });
      }
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.delete('/rooms/:id', (req, res) => {
    const { id } = req.params;
    const room = getRoomById(db, id);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Wenn room aktiv, werfe clients raus
    if (activeRooms.has(room.slug)) {
      const state = activeRooms.get(room.slug);
      for (const [ws, _] of state.clients) {
        ws.send(JSON.stringify({ type: 'error', code: 'ROOM_DELETED' }));
        ws.close();
      }
      activeRooms.delete(room.slug);
    }

    deleteRoom(db, id);
    res.json({ success: true });
  });

  router.get('/rooms/:id/canvas', (req, res) => {
    const { id } = req.params;
    const room = getRoomById(db, id);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    let canvasData = room.canvas_data;
    
    // Bevorzuge In-Memory Daten falls Raum aktiv
    if (activeRooms.has(room.slug)) {
      const state = activeRooms.get(room.slug);
      canvasData = JSON.stringify({ strokes: state.strokes, erased: Array.from(state.eraserStrokes) });
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(canvasData);
  });

  router.post('/rooms/:id/clear', (req, res) => {
    const { id } = req.params;
    const room = getRoomById(db, id);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const emptyCanvas = JSON.stringify({ strokes: [], erased: [] });

    if (activeRooms.has(room.slug)) {
      const state = activeRooms.get(room.slug);
      state.strokes = [];
      state.eraserStrokes.clear();
      state.lastSaved = Date.now();
      
      const msg = JSON.stringify({ type: 'clear' });
      for (const [ws, _] of state.clients) {
        ws.send(msg);
      }
    }

    updateCanvasData(db, id, emptyCanvas);
    res.json({ success: true });
  });

  return router;
}
