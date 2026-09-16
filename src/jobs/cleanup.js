import cron from 'node-cron';
import { getExpiredRooms, deleteRoom, updateCanvasData } from '../db/queries.js';

export function startCleanupJob(db, activeRooms) {
  const ROOM_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(7 * 24 * 60 * 60 * 1000));
  const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24');
  
  // Cron schedule string basierend auf CLEANUP_INTERVAL_HOURS
  // Ein einfacher Ansatz: Jede Stunde laufen lassen und checken
  const schedule = '0 * * * *'; 

  cron.schedule(schedule, () => {
    console.log(`[${new Date().toISOString()}] Starte Cleanup Job...`);
    try {
      const expiredRooms = getExpiredRooms(db, ROOM_TTL_MS);
      let deletedCount = 0;
      
      for (const room of expiredRooms) {
        // Falls Room noch im Memory ist, vorher speichern
        if (activeRooms.has(room.slug)) {
          const state = activeRooms.get(room.slug);
          const canvasData = JSON.stringify({ strokes: state.strokes, erased: Array.from(state.eraserStrokes) });
          updateCanvasData(db, room.id, canvasData);
          // Optional: activeRooms.delete(room.slug) - aber wenn er aktiv ist, ist er eigentlich nicht expired
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
