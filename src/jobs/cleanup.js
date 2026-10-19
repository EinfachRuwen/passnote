import cron from 'node-cron';
import { getExpiredRooms, deleteRoom } from '../db/queries.js';

export function startCleanupJob(db, activeRooms) {
  const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(7 * 24 * 60 * 60 * 1000));

  // Jede Stunde nach abgelaufenen temporären Räumen suchen
  const schedule = '0 * * * *';

  cron.schedule(schedule, () => {
    console.log(`[${new Date().toISOString()}] Starte Cleanup Job...`);
    try {
      const expiredRooms = getExpiredRooms(db, ROOM_TTL_MS);
      let deletedCount = 0;

      for (const room of expiredRooms) {
        // Raum mit verbundenen Nutzern ist nicht inaktiv
        const state = activeRooms.get(room.slug);
        if (state && state.clients.size > 0) continue;
        if (state) {
          clearTimeout(state.saveTimer);
          activeRooms.delete(room.slug);
        }

        deleteRoom(db, room.id);
        deletedCount++;
        console.log(`[${new Date().toISOString()}] Room gelöscht: ${room.slug} (${room.id})`);
      }

      console.log(`[${new Date().toISOString()}] Cleanup beendet. ${deletedCount} Rooms gelöscht.`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Fehler im Cleanup Job:`, err);
    }
  });

  console.log(`[${new Date().toISOString()}] Cleanup Job registriert. (Cron: ${schedule})`);
}
