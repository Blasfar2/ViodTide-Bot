import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { RulesError } from './rules-errors.js';

const defaultPath = fileURLToPath(new URL('../../data/rules.json', import.meta.url));

function isObject(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isGuildId(value) {
  return typeof value === 'string' && value.length > 0
    && !['__proto__', 'prototype', 'constructor'].includes(value);
}

function isJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !isObject(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((entry) => isJson(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isState(value) {
  return isObject(value) && Object.keys(value).length === 2
    && value.version === 1 && isObject(value.guilds)
    && Object.entries(value.guilds).every(([guildId, settings]) => (
      isGuildId(guildId) && isObject(settings) && isJson(settings)
    ));
}

/** A single-process store. Keep one instance per state file and persist its data directory. */
export class RulesStore {
  #filePath;
  #fileTail = Promise.resolve();
  #guildTails = new Map();

  constructor(filePath = defaultPath) {
    this.#filePath = filePath;
  }

  // Reads share this queue so a get after a set observes that completed update.
  #withFileLock(callback) {
    const result = this.#fileTail.then(callback);
    this.#fileTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #read() {
    let contents;
    try {
      contents = await readFile(this.#filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, guilds: {} };
      throw new RulesError('The rules configuration could not be read. Check storage permissions before retrying.');
    }

    let state;
    try {
      state = JSON.parse(contents);
    } catch {
      throw new RulesError('The saved rules configuration is invalid. Restore the data file from a backup before retrying.');
    }
    if (!isState(state)) {
      throw new RulesError('The saved rules configuration is invalid. Restore the data file from a backup before retrying.');
    }
    return state;
  }

  async #write(state) {
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      });
      await rename(temporaryPath, this.#filePath);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw new RulesError('The rules configuration could not be saved. Check storage permissions and available disk space before retrying.');
    }
  }

  async get(guildId) {
    if (!isGuildId(guildId)) throw new TypeError('A guild ID is required.');
    return this.#withFileLock(async () => {
      const state = await this.#read();
      return Object.hasOwn(state.guilds, guildId) ? clone(state.guilds[guildId]) : null;
    });
  }

  /** Merge a JSON settings patch without discarding the other guilds or existing fields. */
  async set(guildId, settings) {
    if (!isGuildId(guildId)) throw new TypeError('A guild ID is required.');
    if (!isObject(settings) || !isJson(settings)) {
      throw new TypeError('Rules settings must be a plain JSON object.');
    }
    const patch = clone(settings);
    return this.#withFileLock(async () => {
      const state = await this.#read();
      const previous = Object.hasOwn(state.guilds, guildId) ? state.guilds[guildId] : {};
      const merged = { ...previous, ...patch };
      state.guilds[guildId] = merged;
      await this.#write(state);
      return clone(merged);
    });
  }

  /** Serialize a guild's Discord operations; get/set use a separate queue and are safe here. */
  async withGuildLock(guildId, callback) {
    if (!isGuildId(guildId)) throw new TypeError('A guild ID is required.');
    if (typeof callback !== 'function') throw new TypeError('A lock callback is required.');
    const previous = this.#guildTails.get(guildId) ?? Promise.resolve();
    const result = previous.then(callback);
    const tail = result.then(() => undefined, () => undefined);
    this.#guildTails.set(guildId, tail);
    try {
      return await result;
    } finally {
      if (this.#guildTails.get(guildId) === tail) this.#guildTails.delete(guildId);
    }
  }
}

export const rulesStore = new RulesStore();
