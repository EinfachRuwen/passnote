import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export function setupDatabase(dbPath) {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  
  // Lese schema.sql
  const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
  let schemaSql;
  try {
      schemaSql = fs.readFileSync(schemaPath, 'utf8');
  } catch (err) {
      // Fallback falls process.cwd() nicht passt
      const altSchemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
      schemaSql = fs.readFileSync(altSchemaPath, 'utf8');
  }
  
  db.exec(schemaSql);
  return db;
}

export function getRoomBySlug(db, slug) {
  const stmt = db.prepare('SELECT * FROM rooms WHERE slug = ?');
  return stmt.get(slug) || null;
}

export function getRoomById(db, id) {
  const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
  return stmt.get(id) || null;
}

export function createRoom(db, { id, slug, name, type, passwordHash, maxUsers }) {
  const stmt = db.prepare(`
    INSERT INTO rooms (id, slug, name, type, password_hash, max_users, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  stmt.run(id, slug, name, type, passwordHash, maxUsers, now, now);
  return getRoomById(db, id);
}

export function updateCanvasData(db, roomId, canvasData) {
  const stmt = db.prepare('UPDATE rooms SET canvas_data = ?, last_active_at = ? WHERE id = ?');
  stmt.run(canvasData, Date.now(), roomId);
}

export function updateLastActive(db, roomId) {
  const stmt = db.prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?');
  stmt.run(Date.now(), roomId);
}

export function deleteRoom(db, roomId) {
  const stmt = db.prepare('DELETE FROM rooms WHERE id = ?');
  stmt.run(roomId);
}

export function getAllRooms(db) {
  const stmt = db.prepare('SELECT id, slug, name, type, max_users, created_at, last_active_at FROM rooms ORDER BY created_at DESC');
  return stmt.all();
}

export function getExpiredRooms(db, ttlMs) {
  const threshold = Date.now() - ttlMs;
  const stmt = db.prepare("SELECT * FROM rooms WHERE type = 'temporary' AND last_active_at < ?");
  return stmt.all(threshold);
}
