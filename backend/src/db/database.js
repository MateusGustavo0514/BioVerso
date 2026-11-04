import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = path.resolve(__dirname, '../..');

const caminhoBanco = path.resolve(RAIZ_BACKEND, process.env.DB_PATH || './data/bioverso.db');
mkdirSync(path.dirname(caminhoBanco), { recursive: true });

export const db = new Database(caminhoBanco);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function aplicarSchema() {
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

export function bancoVazio() {
  return db.prepare('SELECT COUNT(*) AS total FROM entidades').get().total === 0;
}
