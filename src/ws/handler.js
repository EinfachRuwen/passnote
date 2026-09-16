import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getRoomBySlug, updateCanvasData, updateLastActive } from '../db/queries.js';

const USER_COLORS = [
  '#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
  '#DB2777', '#0891B2', '#65A30D', '#9333EA', '#EA580C'
];

function broadcast(roomState, messageStr, excludeWs = null) {
  for (const [ws, _] of roomState.clients) {
    if (ws !== excludeWs && ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(messageStr);
    }
  }
}

export function setupWsHandler(wss, db, activeRooms) {
  // Heartbeat alle 30 Sekunden
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.send(JSON.stringify({ type: 'ping' }));
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', async (ws, req) => {
    ws.isAlive = true;
    
    // Parse URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const slug = url.searchParams.get('room');

    if (!slug) {
      ws.send(JSON.stringify({ type: 'error', code: 'ROOM_NOT_FOUND' }));
      return ws.close();
    }

    const room = getRoomBySlug(db, slug);
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', code: 'ROOM_NOT_FOUND' }));
      return ws.close();
    }

    // Get or initialize room state
    let roomState = activeRooms.get(slug);
    if (!roomState) {
      let strokes = [];
      let erased = [];
      try {
        const parsed = JSON.parse(room.canvas_data);
        strokes = parsed.strokes || [];
        erased = parsed.erased || [];
      } catch (e) {
        // Fallback: ignoriere fehlerhafte Canvas-Daten, starte mit leerem Board
        strokes = [];
        erased = [];
      }

      roomState = {
        clients: new Map(),
        strokes: strokes,
        eraserStrokes: new Set(erased),
        lastSaved: Date.now(),
        colorIndex: 0
      };
      activeRooms.set(slug, roomState);
    }

    if (roomState.clients.size >= room.max_users) {
      ws.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL' }));
      return ws.close();
    }

    let isAuthenticated = false;
    let userId = uuidv4();
    
    // Auth Timeout (5s)
    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) {
        ws.send(JSON.stringify({ type: 'error', code: 'AUTH_TIMEOUT' }));
        ws.close();
      }
    }, 5000);

    ws.on('message', async (messageBuffer) => {
      let msg;
      try {
        msg = JSON.parse(messageBuffer.toString());
      } catch (e) {
        return;
      }

      if (msg.type === 'pong') {
        ws.isAlive = true;
        return;
      }

      if (!isAuthenticated) {
        if (msg.type === 'auth') {
          if (room.password_hash) {
            const match = await bcrypt.compare(msg.password || '', room.password_hash);
            if (!match) {
              ws.send(JSON.stringify({ type: 'error', code: 'WRONG_PASSWORD' }));
              return ws.close();
            }
          }
          
          clearTimeout(authTimeout);
          isAuthenticated = true;

          // Assign color
          const color = USER_COLORS[roomState.colorIndex % USER_COLORS.length];
          roomState.colorIndex++;

          roomState.clients.set(ws, { userId, color, joinedAt: Date.now() });

          // Send welcome
          ws.send(JSON.stringify({
            type: 'welcome',
            userId,
            color,
            users: roomState.clients.size,
            canvas: {
              strokes: roomState.strokes,
              erased: Array.from(roomState.eraserStrokes)
            }
          }));

          // Notify others
          broadcast(roomState, JSON.stringify({
            type: 'user_joined',
            userId,
            color,
            users: roomState.clients.size
          }), ws);

          updateLastActive(db, room.id);
        }
        return;
      }

      // Handle authenticated messages
      try {
        switch (msg.type) {
          case 'stroke_start':
          case 'stroke_point':
          case 'stroke_end':
            // Stroke persistenz und broadcast
            const clientInfo = roomState.clients.get(ws);
            if (msg.type === 'stroke_start') {
              const newStroke = {
                id: msg.id,
                userId: clientInfo.userId,
                color: msg.color || clientInfo.color,
                width: msg.width || 2,
                tool: msg.tool || 'pen',
                points: [],
                text: msg.text,
                x: msg.x,
                y: msg.y,
                fontSize: msg.fontSize
              };
              roomState.strokes.push(newStroke);
            } else if (msg.type === 'stroke_point') {
              const stroke = roomState.strokes.find(s => s.id === msg.id);
              if (stroke) {
                stroke.points.push({ x: msg.x, y: msg.y, p: msg.p });
              }
            }

            msg.userId = clientInfo.userId;
            broadcast(roomState, JSON.stringify(msg), ws);
            triggerAutoSave(db, room.id, roomState);
            break;

          case 'cursor':
          case 'laser':
            msg.userId = roomState.clients.get(ws).userId;
            broadcast(roomState, JSON.stringify(msg), ws);
            break;

          case 'undo':
            const uInfo = roomState.clients.get(ws);
            // Finde den letzten Stroke dieses Nutzers
            const userStrokes = roomState.strokes.filter(s => s.userId === uInfo.userId && !roomState.eraserStrokes.has(s.id));
            if (userStrokes.length > 0) {
              const lastStroke = userStrokes[userStrokes.length - 1];
              roomState.eraserStrokes.add(lastStroke.id);
              broadcast(roomState, JSON.stringify({ type: 'undo', userId: uInfo.userId, strokeId: lastStroke.id }));
              triggerAutoSave(db, room.id, roomState);
            }
            break;

          case 'erase_stroke':
            if (msg.strokeId) {
                roomState.eraserStrokes.add(msg.strokeId);
                broadcast(roomState, JSON.stringify({ type: 'undo', strokeId: msg.strokeId }));
                triggerAutoSave(db, room.id, roomState);
            }
            break;

          case 'clear':
            roomState.strokes = [];
            roomState.eraserStrokes.clear();
            const cInfo = roomState.clients.get(ws);
            broadcast(roomState, JSON.stringify({ type: 'clear', userId: cInfo.userId }));
            triggerAutoSave(db, room.id, roomState);
            break;
        }
      } catch (err) {
        console.error('Error handling message:', err);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (roomState.clients.has(ws)) {
        const info = roomState.clients.get(ws);
        roomState.clients.delete(ws);
        
        broadcast(roomState, JSON.stringify({
          type: 'user_left',
          userId: info.userId,
          users: roomState.clients.size
        }));

        if (roomState.clients.size === 0) {
          // Speichere und entferne aus activeRooms
          saveCanvasToDb(db, room.id, roomState);
          activeRooms.delete(slug);
        }
      }
    });
  });

  function triggerAutoSave(db, roomId, roomState) {
    const now = Date.now();
    if (now - roomState.lastSaved > 60000) { // alle 60 Sekunden
      saveCanvasToDb(db, roomId, roomState);
      roomState.lastSaved = now;
    }
  }

  function saveCanvasToDb(db, roomId, roomState) {
    const data = JSON.stringify({
      strokes: roomState.strokes,
      erased: Array.from(roomState.eraserStrokes)
    });
    try {
      updateCanvasData(db, roomId, data);
    } catch (err) {
      console.error('AutoSave failed:', err);
    }
  }
}
