import { updateCanvasData } from '../db/queries.js';

// Wie viele Zettel pro Raum aufgehoben werden
export const MAX_NOTES = 150;

export function parseNotes(canvasData) {
  try {
    const parsed = JSON.parse(canvasData);
    if (parsed && Array.isArray(parsed.notes)) return parsed.notes;
  } catch (err) {
    // Alte oder kaputte Daten werden verworfen
  }
  return [];
}

export function serializeNotes(notes) {
  return JSON.stringify({ notes });
}

export function saveRoomState(db, state) {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  updateCanvasData(db, state.roomId, serializeNotes(state.notes));
}

// Speichert gebündelt, aber spätestens nach `delay` ms – es geht nichts verloren
export function scheduleSave(db, state, delay = 2000) {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    try {
      saveRoomState(db, state);
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
    }
  }, delay);
}

export function saveAllRooms(db, activeRooms) {
  for (const [slug, state] of activeRooms.entries()) {
    try {
      saveRoomState(db, state);
    } catch (err) {
      console.error(`Fehler beim Sichern von ${slug}:`, err);
    }
  }
}
