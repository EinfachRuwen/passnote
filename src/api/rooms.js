import { Router } from 'express';
import QRCode from 'qrcode';
import { getRoomBySlug } from '../db/queries.js';

export function createRoomsRouter(db, activeRooms) {
  const router = Router();

  router.get('/:slug/info', (req, res) => {
    const { slug } = req.params;
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
    const boardUrl = `${protocol}://${host}/?room=${slug}`;

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
