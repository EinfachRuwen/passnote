import { Router } from 'express';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getRoomBySlug, createRoom } from '../db/queries.js';
import { generateSlug } from '../utils/slug.js';

export function createRoomsRouter(db, activeRooms) {
  const router = Router();
  
  // Normaler Nutzer erstellt einen temporären Raum (optional mit Passwort)
  router.post('/', async (req, res) => {
    try {
      const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 100) : '';
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;

      let slug = generateSlug();
      for (let i = 0; i < 10 && getRoomBySlug(db, slug); i++) slug = generateSlug();

      const room = createRoom(db, {
        id: uuidv4(),
        slug,
        name: null,
        type: 'temporary',
        passwordHash,
        maxUsers: parseInt(process.env.MAX_USERS_DEFAULT || '50')
      });

      res.json({ success: true, slug: room.slug });
    } catch (err) {
      console.error('Error creating public room:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/:slug/info', (req, res) => {
    const slug = req.params.slug.toLowerCase();
    const room = getRoomBySlug(db, slug);
    
    if (!room) {
      return res.status(404).json({ exists: false });
    }

    let userCount = 0;
    if (activeRooms.has(slug)) {
      userCount = activeRooms.get(slug).clients.size;
    }

    res.json({
      exists: true,
      hasPassword: !!room.password_hash,
      userCount,
      type: room.type,
      maxUsers: room.max_users
    });
  });

  router.get('/:slug/qr', async (req, res) => {
    const { slug } = req.params;
    
    // Einfache Überprüfung
    const room = getRoomBySlug(db, slug);
    if (!room) {
      return res.status(404).send('Room not found');
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const boardUrl = `${protocol}://${host}/board.html?room=${slug}`;

    try {
      const qrSvg = await QRCode.toString(boardUrl, {
        type: 'svg',
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h cache
      res.send(qrSvg);
    } catch (err) {
      console.error('Error generating QR:', err);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
