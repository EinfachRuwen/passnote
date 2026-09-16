import { getRoomBySlug, updateCanvasData } from '../db/queries.js';

export function setupWsHandler(wss, db, activeRooms) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const roomSlug = url.searchParams.get('room');

    if (!roomSlug) {
      ws.close(1008, 'Room required');
      return;
    }

    const room = getRoomBySlug(db, roomSlug);
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', code: 'ROOM_NOT_FOUND' }));
      ws.close();
      return;
    }

    if (!activeRooms.has(roomSlug)) {
      let initialHistory = [];
      try {
        if (room.canvas_data && room.canvas_data.length > 5) {
            const parsed = JSON.parse(room.canvas_data);
            if (Array.isArray(parsed.chatHistory)) {
                initialHistory = parsed.chatHistory;
            } else if (Array.isArray(parsed)) {
                initialHistory = parsed;
            }
        }
      } catch (e) {
          console.error('JSON Parse error', e);
      }
      activeRooms.set(roomSlug, {
        clients: new Map(),
        chatHistory: initialHistory,
        lastSaved: Date.now()
      });
    }

    const roomState = activeRooms.get(roomSlug);

    if (roomState.clients.size >= room.max_users) {
      ws.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL' }));
      ws.close();
      return;
    }

    const USER_COLORS = ['#60A5FA', '#F87171', '#34D399', '#FBBF24', '#A78BFA', '#F472B6', '#2DD4BF', '#84CC16', '#C084FC', '#FB923C'];

    let isAuthed = false;

    const authTimeout = setTimeout(() => {
      if (!isAuthed) ws.close();
    }, 5000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'auth') {
          if (room.password_hash) {
            import('bcryptjs').then(bcrypt => {
              bcrypt.default.compare(msg.password || '', room.password_hash).then(match => {
                if (match) finishAuth(msg.username);
                else ws.send(JSON.stringify({ type: 'error', code: 'WRONG_PASSWORD' }));
              });
            });
          } else {
            finishAuth(msg.username);
          }
          return;
        }

        if (!isAuthed) return;

        switch (msg.type) {
          case 'chat_message':
            const clientInfo = roomState.clients.get(ws);
            const newMsg = {
                id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString() + Math.random().toString(),
                userId: clientInfo.userId,
                username: clientInfo.username,
                color: clientInfo.color,
                timestamp: Date.now(),
                strokes: msg.strokes,
                aspectRatio: msg.aspectRatio
            };
            
            roomState.chatHistory.push(newMsg);
            
            // Limit history to last 50 messages to save memory
            if (roomState.chatHistory.length > 50) {
                roomState.chatHistory.shift();
            }

            broadcast(roomState, JSON.stringify({
                type: 'chat_message',
                ...newMsg
            }));
            
            triggerAutoSave(db, room.id, roomState);
            break;
            
          case 'clear':
            roomState.chatHistory = [];
            triggerAutoSave(db, room.id, roomState);
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (err) {
        console.error('WS Error:', err);
      }
    });

    ws.on('close', () => {
      if (roomState.clients.has(ws)) {
        roomState.clients.delete(ws);
        broadcastActiveUsers(roomState);
      }
    });

    function finishAuth(username) {
      clearTimeout(authTimeout);
      isAuthed = true;

      const userId = Date.now().toString() + Math.random().toString();
      const color = USER_COLORS[roomState.clients.size % USER_COLORS.length];
      const safeName = (username || 'Anon').substring(0, 15);

      roomState.clients.set(ws, { userId, color, username: safeName, joinedAt: Date.now() });

      const usersList = getActiveUsersList(roomState);

      ws.send(JSON.stringify({
        type: 'welcome',
        userId,
        color,
        usersList,
        canvas: { chatHistory: roomState.chatHistory }
      }));

      broadcastActiveUsers(roomState);
    }
  });

  function getActiveUsersList(roomState) {
      const list = [];
      for (const client of roomState.clients.values()) {
          list.push({ userId: client.userId, username: client.username, color: client.color });
      }
      return list;
  }

  function broadcastActiveUsers(roomState) {
      const list = getActiveUsersList(roomState);
      broadcast(roomState, JSON.stringify({ type: 'active_users', usersList: list }));
  }

  function broadcast(roomState, message, excludeWs = null) {
    for (const [clientWs, _] of roomState.clients) {
      if (clientWs !== excludeWs && clientWs.readyState === 1) {
        clientWs.send(message);
      }
    }
  }

  function triggerAutoSave(db, roomId, roomState) {
    const now = Date.now();
    if (now - roomState.lastSaved > 10000) {
      roomState.lastSaved = now;
      const data = JSON.stringify({ chatHistory: roomState.chatHistory });
      updateCanvasData(db, roomId, data);
    }
  }
}
