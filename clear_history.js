import Database from 'better-sqlite3';
const db = new Database('./data/passnote.db');
db.prepare("UPDATE rooms SET canvas_data = '{}'").run();
console.log("Cleared chat history");
