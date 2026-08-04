/**
 * Tiny JSON-file data store (demo).
 * Mirrors a DynamoDB-style document model so migration to AWS is 1:1:
 *   users | content | products | events | submissions
 * Swap this module for a DynamoDB client later; the API layer stays unchanged.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { users: [], content: {}, products: [], events: [], submissions: [] };

let cache = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    cache = JSON.parse(JSON.stringify(EMPTY));
    save();
    return cache;
  }
  try {
    cache = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) {
    console.error('[db] corrupt db.json, starting empty:', e.message);
    cache = JSON.parse(JSON.stringify(EMPTY));
  }
  return cache;
}

function db() {
  if (!cache) load();
  return cache;
}

function save() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = { db, load, save, DB_FILE, DATA_DIR };
