import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/** Persistent application documents. Transactions must be synchronous. One bot process per database. */
export class Store {
  constructor(path = fileURLToPath(new URL('../../data/community.sqlite', import.meta.url))) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('Unsupported community database version.'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS documents (
      guild TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY(guild, namespace, key)); PRAGMA user_version=1;`);
    this.locks = new Map();
  }
  get(guild, namespace, key) {
    const row = this.db.prepare('SELECT value FROM documents WHERE guild=? AND namespace=? AND key=?').get(guild, namespace, key);
    return row ? JSON.parse(row.value) : null;
  }
  set(guild, namespace, key, value) {
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(guild,namespace,key) DO UPDATE SET value=excluded.value')
      .run(guild, namespace, key, JSON.stringify(value));
    return value;
  }
  list(guild, namespace) {
    return this.db.prepare('SELECT key,value FROM documents WHERE guild=? AND namespace=? ORDER BY key').all(guild, namespace)
      .map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }
  delete(guild, namespace, key) {
    this.db.prepare('DELETE FROM documents WHERE guild=? AND namespace=? AND key=?').run(guild, namespace, key);
  }
  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      if (result?.then) throw new Error('Database transactions must not await network requests.');
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async lock(key, callback) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const result = previous.then(callback);
    const tail = result.then(() => {}, () => {});
    this.locks.set(key, tail);
    try { return await result; }
    finally { if (this.locks.get(key) === tail) this.locks.delete(key); }
  }
  close() { this.db.close(); }
}
