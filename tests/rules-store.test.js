import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RulesError } from '../src/services/rules-errors.js';
import { RulesStore } from '../src/services/rules-store.js';

const guildId = '123456789012345678';
const otherGuildId = '234567890123456789';

async function makeStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'voidtide-rules-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'nested', 'rules.json');
  return { directory, filePath, store: new RulesStore(filePath) };
}

test('missing rules data starts empty and settings survive a restart', async (t) => {
  const { store, filePath } = await makeStore(t);
  assert.equal(await store.get(guildId), null);
  const settings = {
    rulesChannelId: '345678901234567890',
    verifiedRoleId: '456789012345678901',
    rulesMessageId: '567890123456789012',
    gatedChannelIds: ['678901234567890123'],
    complete: true,
  };
  assert.deepEqual(await store.set(guildId, settings), settings);
  assert.deepEqual(await new RulesStore(filePath).get(guildId), settings);
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
    version: 1, guilds: { [guildId]: settings },
  });
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(join(filePath, '..')), ['rules.json']);
});

test('parallel settings patches preserve all fields and every guild', async (t) => {
  const { store } = await makeStore(t);
  await Promise.all([
    store.set(guildId, { rulesChannelId: 'channel' }),
    store.set(otherGuildId, { verifiedRoleId: 'other-role' }),
    store.set(guildId, { verifiedRoleId: 'role' }),
    store.set(guildId, { rulesMessageId: 'message' }),
  ]);
  assert.deepEqual(await store.get(guildId), {
    rulesChannelId: 'channel', verifiedRoleId: 'role', rulesMessageId: 'message',
  });
  assert.deepEqual(await store.get(otherGuildId), { verifiedRoleId: 'other-role' });
});

test('settings snapshots cannot be mutated through inputs or returned values', async (t) => {
  const { store } = await makeStore(t);
  const initial = { gatedChannelIds: ['channel'], nested: { enabled: true } };
  const pending = store.set(guildId, initial);
  initial.gatedChannelIds.push('unexpected-input-mutation');
  initial.nested.enabled = false;
  const saved = await pending;
  saved.gatedChannelIds.push('unexpected-output-mutation');
  const loaded = await store.get(guildId);
  loaded.nested.enabled = false;
  assert.deepEqual(await store.get(guildId), {
    gatedChannelIds: ['channel'], nested: { enabled: true },
  });
});

test('get observes an earlier queued set without requiring its caller to await it', async (t) => {
  const { store } = await makeStore(t);
  const update = store.set(guildId, { complete: true });
  assert.deepEqual(await store.get(guildId), { complete: true });
  await update;
});

test('invalid JSON and unsupported data shapes fail closed without overwriting the file', async (t) => {
  const { store, filePath } = await makeStore(t);
  await store.set(guildId, { complete: true });
  const badStates = [
    '{private-test-content',
    'null',
    '[]',
    JSON.stringify({ version: 2, guilds: {} }),
    JSON.stringify({ version: 1, guilds: [] }),
    JSON.stringify({ version: 1, guilds: { [guildId]: [] } }),
    JSON.stringify({ version: 1, guilds: { [guildId]: null } }),
    JSON.stringify({ version: 1, guilds: {}, unexpected: true }),
  ];
  for (const contents of badStates) {
    await writeFile(filePath, contents);
    for (const operation of [() => store.get(guildId), () => store.set(guildId, { complete: false })]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(error instanceof RulesError);
        assert.match(error.message, /invalid/);
        assert.doesNotMatch(error.message, /private-test-content/);
        return true;
      });
      assert.equal(await readFile(filePath, 'utf8'), contents);
    }
  }
  await writeFile(filePath, JSON.stringify({ version: 1, guilds: {} }));
  assert.deepEqual(await store.set(guildId, { complete: true }), { complete: true });
});

test('non-JSON patches and unsafe map keys are rejected before modifying storage', async (t) => {
  const { store } = await makeStore(t);
  const circular = {};
  circular.self = circular;
  for (const settings of [null, [], { value: undefined }, { value: Infinity }, circular, { value: new Date() }]) {
    await assert.rejects(store.set(guildId, settings), TypeError);
  }
  for (const invalidId of ['', null, '__proto__', 'constructor']) {
    await assert.rejects(store.get(invalidId), TypeError);
    await assert.rejects(store.set(invalidId, {}), TypeError);
    await assert.rejects(store.withGuildLock(invalidId, () => {}), TypeError);
  }
  assert.equal(await store.get(guildId), null);
});

test('read errors are safe and do not poison the file queue after storage is repaired', async (t) => {
  const { directory } = await makeStore(t);
  const blockingPath = join(directory, 'blocking-file');
  await writeFile(blockingPath, 'not a directory');
  const store = new RulesStore(join(blockingPath, 'rules.json'));
  await assert.rejects(store.set(guildId, { complete: true }), (error) => {
    assert.ok(error instanceof RulesError);
    assert.match(error.message, /could not be read/);
    assert.equal(error.message.includes(blockingPath), false);
    return true;
  });
  await rm(blockingPath);
  await store.set(guildId, { complete: true });
  assert.deepEqual(await store.get(guildId), { complete: true });
});

test('guild locks serialize one guild, allow another, and release after callback failure', async (t) => {
  const { store } = await makeStore(t);
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = store.withGuildLock(guildId, async () => {
    events.push('first entered');
    await firstGate;
    await store.set(guildId, { verifiedRoleId: 'role' });
    events.push('first leaving');
    throw new Error('intentional callback failure');
  });
  const expectedFailure = assert.rejects(first, /intentional callback failure/);
  const second = store.withGuildLock(guildId, async () => {
    events.push('second entered');
    const settings = await store.get(guildId);
    return settings.verifiedRoleId;
  });
  await store.withGuildLock(otherGuildId, async () => { events.push('other guild entered'); });
  assert.deepEqual(events, ['first entered', 'other guild entered']);
  releaseFirst();
  await expectedFailure;
  assert.equal(await second, 'role');
  assert.deepEqual(events, ['first entered', 'other guild entered', 'first leaving', 'second entered']);
  assert.equal(await store.withGuildLock(guildId, async () => 'still usable'), 'still usable');
});
