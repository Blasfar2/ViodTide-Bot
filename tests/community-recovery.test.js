import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayIntentBits } from 'discord.js';
import { Store } from '../src/database/store.js';
import { readConfig } from '../src/config/env.js';
import { createBotClient } from '../src/services/client.js';
import { StreamService } from '../src/services/stream-service.js';
import { configFor, embed, UserError } from '../src/services/management-utils.js';
import { fixture } from './helpers/community-fixture.js';

test('community intents require explicit opt-in and real client closes its injected storage cleanly', async () => {
  const store = new Store(':memory:');
  const client = createBotClient({ config: { guildId: '100000000000000001', clientId: '100000000000000002' }, logger: { error() {}, info() {} }, onFatal() {}, communityEnabled: true, managementStore: store });
  assert.equal(client.options.intents.has([GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]), true);
  assert.equal(client.listenerCount('messageCreate'), 1); assert.equal(client.listenerCount('guildMemberAdd'), 1);
  await client.destroy();
  assert.throws(() => store.get('g', 'n', 'k'));
});

test('invalid community opt-in values fail without echoing the supplied value', () => {
  assert.throws(() => readConfig({ ENABLE_COMMUNITY: 'secret-invalid-value' }), (error) => {
    assert.match(error.message, /ENABLE_COMMUNITY/); assert.equal(error.message.includes('secret-invalid-value'), false); return true;
  });
});

test('partial server creation resumes using recorded gates without duplicate resources', async (t) => {
  const f = await fixture(t); const create = f.guild.channels.create; let count = 0;
  f.guild.channels.create = async (...args) => { if (++count === 5) throw new Error('simulated Discord failure'); return create(...args); };
  await f.management.execute(f.interaction('setup-server'));
  await assert.rejects(f.management.execute(f.interaction('setup-server', { confirm: true })), /simulated/);
  assert.equal(Boolean(configFor(f.store, f.guild.id).complete), false);
  f.guild.channels.create = create;
  await f.setup();
  assert.equal(configFor(f.store, f.guild.id).complete, true);
  assert.equal(new Set([...f.guild.channels.cache.values()].map((c) => c.name)).size, f.guild.channels.cache.size);
  assert.equal(new Set([...f.guild.roles.cache.values()].map((r) => r.name)).size, f.guild.roles.cache.size);
});

test('the actual managed bot role is preserved without assigning or weakening it', async (t) => {
  const f = await fixture(t); f.botRole.name = 'VOIDTIDE Bot'; f.botRole.managed = true; f.botRole.editable = false; f.botRole.tags = { botId: f.bot.id };
  await f.setup();
  assert.equal(f.guild.roles.cache.get(f.botRole.id).name, 'VOIDTIDE Bot');
  assert.equal(f.botRole.managed, true); assert.equal(f.botRole.editable, false);
  assert.equal(f.calls.filter(([kind, options]) => kind === 'role' && options.name === 'VOIDTIDE Bot').length, 0);
});

test('welcome and goodbye sends are deduplicated, and screening never receives an automatic role', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  assert.equal(config.channels.welcome, undefined); assert.equal(config.welcomeEnabled, false);
  const legacy = f.addChannel('legacy-greetings');
  config.channels.welcome = legacy.id; config.roles.Newcomer = f.role('Newcomer').id; config.welcomeEnabled = true;
  f.store.set(f.guild.id, 'config', 'server', config);
  f.ordinary.pending = true;
  await f.management.community.memberEvent(f.ordinary, true); await f.management.community.memberEvent(f.ordinary, true);
  assert.equal(f.ordinary.roles.cache.has(config.roles.Newcomer), false);
  const channel = f.guild.channels.cache.get(config.channels.welcome);
  assert.equal(channel.messages.cache.size, 1);
  const welcome = [...channel.messages.cache.values()][0]; assert.deepEqual(welcome.allowedMentions.users, [f.ordinary.id]); assert.deepEqual(welcome.allowedMentions.parse, []);
  await f.management.community.memberEvent(f.ordinary, false); await f.management.community.memberEvent(f.ordinary, false);
  assert.equal(channel.messages.cache.size, 2);
});

test('ticket reuse follows saved channel IDs and refuses new unintended visibility grants', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  const request = f.interaction('ticket', { category: 'General Help' }, f.ordinary);
  await f.management.execute(request);
  const ticket = f.store.list(f.guild.id, 'tickets')[0].value;
  const channel = f.guild.channels.cache.get(ticket.channelId); channel.topic = 'Staff updated this topic';
  await f.management.execute(request); assert.equal(f.store.list(f.guild.id, 'tickets').length, 1);
  const other = f.member(); await channel.permissionOverwrites.edit(other.id, { ViewChannel: true });
  await assert.rejects(f.management.execute(request), /unrelated visibility grant/);
});

test('scheduled creation, listing, cancellation, and revoked author permissions are handled safely', async (t) => {
  const f = await fixture(t); await f.setup();
  const request = f.interaction('schedule-announcement', { subcommand: 'create', time: new Date(Date.now() + 60_000).toISOString(), title: 'Gaming', description: 'Meet tonight' });
  await f.management.execute(request);
  const listed = await f.management.execute(f.interaction('schedule-announcement', { subcommand: 'list' })); assert.match(listed.content, new RegExp(request.id));
  await f.management.execute(f.interaction('schedule-announcement', { subcommand: 'cancel', id: request.id }));
  assert.equal(f.store.get(f.guild.id, 'jobs', request.id).status, 'cancelled');
  const job = f.store.get(f.guild.id, 'jobs', request.id);
  f.store.set(f.guild.id, 'jobs', 'revoked', { ...job, createdBy: f.ordinary.id, status: 'pending', runAt: 0 });
  await f.management.tick(); assert.equal(f.store.get(f.guild.id, 'jobs', 'revoked').status, 'retry');
  assert.equal(f.guild.channels.cache.get(job.channelId).messages.cache.size, 0);
});

test('all live moderation actions require permissions and persist audit outcomes', async (t) => {
  const f = await fixture(t); await f.setup();
  for (const action of ['timeout', 'kick', 'ban']) {
    await assert.rejects(f.management.execute(f.interaction(action, { member: f.owner.user, reason: 'No', minutes: 1 }, f.ordinary)), /permission/);
    const request = f.interaction(action, { member: f.ordinary.user, reason: 'Test reason', minutes: 1 });
    await f.management.execute(request);
    assert.equal(f.store.get(f.guild.id, 'cases', request.id).status, 'completed');
    assert.ok(f.calls.some(([kind]) => kind === action));
  }
});

test('clear preserves owner, administrator, bot, pinned, and old messages', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id); const channel = f.guild.channels.cache.get(config.channels.general);
  const target = async (author, changes = {}) => { const message = await channel.send({ embeds: [embed('Message', 'Text')] }); Object.assign(message, { author }, changes); return message; };
  const ordinary = await target(f.ordinary.user); await target(f.owner.user); await target(f.client.user);
  await target(f.ordinary.user, { pinned: true }); await target(f.ordinary.user, { createdTimestamp: Date.now() - 15 * 86400_000 });
  await f.management.execute(f.interaction('clear', { count: 100, channelId: channel.id }));
  assert.equal(channel.messages.cache.has(ordinary.id), false); assert.equal(channel.messages.cache.size, 4);
});

test('logs refuse public destinations and never publish confidential moderation details there', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id); const channel = f.guild.channels.cache.get(config.channels['mod-logs']);
  await channel.permissionOverwrites.edit(f.guild.id, { ViewChannel: true });
  await assert.rejects(f.management.log(f.guild, 'mod-logs', 'case:private', 'Private case', 'Confidential details'), /not private/);
  assert.equal(channel.messages.cache.size, 0);
});

test('event creation is deduplicated and includes textual announcements', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  const request = f.interaction('event', { title: 'Community Games', description: 'Accessible text instructions available here.', location: 'Gaming Room 1 and text chat', start: new Date(Date.now() + 60_000).toISOString(), end: new Date(Date.now() + 3600_000).toISOString() });
  await f.management.execute(request); await f.management.execute(request);
  assert.equal(f.guild.scheduledEvents.events.size, 1);
  assert.equal(f.guild.channels.cache.get(config.channels.events).messages.cache.size, 1);
  assert.equal(f.guild.channels.cache.get(config.channels.announcements).messages.cache.size, 1);
});

test('a newer reward job generation is preserved when old asynchronous work finishes', async (t) => {
  const f = await fixture(t); await f.setup();
  const id = `rewards:${f.ordinary.id}`;
  f.store.set(f.guild.id, 'jobs', id, { type: 'rewards', userId: f.ordinary.id, generation: 1, runAt: 0, status: 'pending', attempts: 0 });
  f.management.community.syncRewards = async () => { f.store.set(f.guild.id, 'jobs', id, { type: 'rewards', userId: f.ordinary.id, generation: 2, runAt: 0, status: 'pending', attempts: 0 }); };
  await f.management.tick(); assert.equal(f.store.get(f.guild.id, 'jobs', id).status, 'pending'); assert.equal(f.store.get(f.guild.id, 'jobs', id).generation, 2);
});

test('expired running jobs recover after restart and repeated failures eventually stop', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  f.store.set(f.guild.id, 'jobs', 'recovered', { type: 'announcement', channelId: config.channels.announcements, createdBy: f.owner.id, payload: { embeds: [embed('Recovered', 'Saved before restart')] }, runAt: 0, status: 'running', leaseUntil: 0, attempts: 0 });
  f.store.set(f.guild.id, 'jobs', 'failed', { type: 'unknown', runAt: 0, status: 'retry', attempts: 4 });
  await f.management.tick(); assert.equal(f.store.get(f.guild.id, 'jobs', 'recovered').status, 'completed'); assert.equal(f.store.get(f.guild.id, 'jobs', 'failed').status, 'failed');
});

test('YouTube catch-up delivers multiple new uploads oldest first and advances the checkpoint', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('youtube'); const account = `UC${'a'.repeat(22)}`; let now = Date.now();
  f.store.set(f.guild.id, 'streams', `youtube:${account}`, { provider: 'youtube', account, channelId: channel.id, playlist: 'uploads', initialized: true, lastId: 'ccccccccccc' });
  const service = new StreamService({ store: f.store, logger: { error() {} }, environment: { YOUTUBE_API_KEY: 'test-key' }, clock: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((id) => ({ snippet: { channelTitle: 'VOIDTIDE', title: id, resourceId: { videoId: id } } })) }) }),
  });
  await service.tick(f.guild); assert.equal(channel.messages.cache.size, 2);
  assert.match([...channel.messages.cache.values()][0].embeds[0].description, /bbbbbbbbbbb/);
  assert.equal(f.store.get(f.guild.id, 'streams', `youtube:${account}`).lastId, 'aaaaaaaaaaa');
  now += 300_001; await service.tick(f.guild); assert.equal(channel.messages.cache.size, 2);
});

test('removing an account during a provider request cannot resurrect it', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('live');
  const key = 'twitch:voidtide'; f.store.set(f.guild.id, 'streams', key, { provider: 'twitch', account: 'voidtide', channelId: channel.id, revision: 1 });
  const service = new StreamService({ store: f.store, logger: { error() {} }, environment: { TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret' },
    fetchImpl: async (url) => ({ ok: true, json: async () => {
      if (String(url).includes('/oauth2/token')) return { access_token: 'test-access', expires_in: 3600 };
      f.store.delete(f.guild.id, 'streams', key); return { data: [{ id: 'stream-1', title: 'Live', user_name: 'VOIDTIDE' }] };
    } }),
  });
  await service.tick(f.guild); assert.equal(f.store.get(f.guild.id, 'streams', key), null); assert.equal(channel.messages.cache.size, 0);
});

test('provider credential absence is reported as a failure without fabricating notifications', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('live');
  f.store.set(f.guild.id, 'streams', 'twitch:voidtide', { provider: 'twitch', account: 'voidtide', channelId: channel.id });
  await f.management.streams.tick(f.guild);
  assert.equal(f.store.get(f.guild.id, 'streams', 'twitch:voidtide').error, true); assert.equal(channel.messages.cache.size, 0);
  await assert.rejects(f.management.execute(f.interaction('stream-config', { subcommand: 'list' }, f.ordinary)), UserError);
});

test('XP administrator adjustments reconcile roles and retain durable recovery work on failure', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  const request = f.interaction('xp-admin', { member: f.ordinary.user, xp: 2500 });
  await f.management.execute(request); assert.equal(f.ordinary.roles.cache.has(config.roles['Level 5']), true);
  await f.management.execute(f.interaction('xp-admin', { member: f.ordinary.user, xp: 0 })); assert.equal(f.ordinary.roles.cache.has(config.roles['Level 5']), false);
  const reward = f.guild.roles.cache.get(config.roles['Level 5']); reward.managed = true;
  await assert.rejects(f.management.execute(f.interaction('xp-admin', { member: f.ordinary.user, xp: 2500 })), /unmanaged/);
  assert.equal(f.store.get(f.guild.id, 'xp', f.ordinary.id).xp, 2500);
  assert.equal(f.store.get(f.guild.id, 'jobs', `rewards:${f.ordinary.id}`).status, 'pending');
  reward.managed = false; await f.management.tick(); assert.equal(f.ordinary.roles.cache.has(reward.id), true);
});

test('welcome configuration refuses private destinations and supports explicit enable/disable', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await assert.rejects(f.management.execute(f.interaction('welcome-config', { enabled: true, channel: f.guild.channels.cache.get(config.channels['staff-chat']) })), /newcomers/);
  await f.management.execute(f.interaction('welcome-config', { enabled: false })); assert.equal(configFor(f.store, f.guild.id).welcomeEnabled, false);
  await assert.rejects(f.management.execute(f.interaction('welcome-config', { enabled: true })), /configure this channel/);
  await f.management.execute(f.interaction('welcome-config', { enabled: true, channel: f.guild.channels.cache.get(config.channels.general) })); assert.equal(configFor(f.store, f.guild.id).welcomeEnabled, true);
});

test('rank, leaderboard, reward, warning and status commands reflect persistent state', async (t) => {
  const f = await fixture(t); await f.setup(); f.store.set(f.guild.id, 'xp', f.ordinary.id, { xp: 2500 });
  const rank = await f.management.execute(f.interaction('rank', { member: f.ordinary.user }, f.ordinary));
  assert.match(rank.embeds[0].toJSON().description, /2500 XP/);
  const board = await f.management.execute(f.interaction('leaderboard', {}, f.ordinary)); assert.match(board.embeds[0].toJSON().description, /Level 5/);
  const rewards = await f.management.execute(f.interaction('level-rewards', {}, f.ordinary)); assert.match(rewards.embeds[0].toJSON().description, /Level \*\*50/);
  const status = await f.management.execute(f.interaction('setup-status')); assert.match(status.content, /completed/);
  const warnings = await f.management.execute(f.interaction('warnings', { member: f.ordinary.user })); assert.match(warnings.content, /No warnings/);
});
