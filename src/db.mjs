import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes, createHash, scryptSync, timingSafeEqual} from 'node:crypto';
import {brand} from './brand.mjs';

export const dataDir = resolve(process.env.DATA_DIR || 'private');
mkdirSync(dataDir, {recursive: true, mode: 0o700});
const identityFile = resolve(dataDir, 'instance.json');
if (existsSync(identityFile)) {
  const identity = JSON.parse(readFileSync(identityFile, 'utf8'));
  if (identity.brandId !== brand.id) throw new Error('This data directory belongs to another brand. Choose an isolated DATA_DIR.');
} else {
  writeFileSync(identityFile, JSON.stringify({schema: 1, brandId: brand.id}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}
export const db = new DatabaseSync(resolve(dataDir, 'site.sqlite'));
chmodSync(resolve(dataDir, 'site.sqlite'), 0o600);
// Empty compatibility tables retain the existing deletion/reference safeguards.
// There are deliberately no homepage, customer, history, or legal content seeds.
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents(kind TEXT,id TEXT,data TEXT);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,kind TEXT,document_id TEXT,data TEXT);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT,mime TEXT,bytes INTEGER,path TEXT);
CREATE TABLE IF NOT EXISTS blog_producer_tokens(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL);
`);
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64, {N: 16384}).toString('hex')}`;
}
export function passwordMatches(password, stored) {
  if (!stored || typeof password !== 'string' || password.length > 512) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/.test(key || '')) return false;
  const expected = Buffer.from(key, 'hex');
  const derived = scryptSync(password, salt, 64, {N: 16384});
  return timingSafeEqual(derived, expected);
}
export function siteSettings() { return Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(row => [row.key, row.value])); }
