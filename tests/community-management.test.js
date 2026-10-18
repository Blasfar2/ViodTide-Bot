import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../src/database/store.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { configFor, embed, futureTime, sendOnce, UserError } from '../src/services/management-utils.js';
import { eligibleXP, levelFor } from '../src/services/community-service.js';
import { recordVote, pollResults } from '../src/services/poll-service.js';
import { assertHierarchy } from '../src/services/moderation-service.js';
import { validateStream, StreamService } from '../src/services/stream-service.js';
import { fixture } from './helpers/community-fixture.js';

test('all requested slash commands serialize with unique names and restricted staff defaults', () => {
  const definitions = getCommandDefinitions(); const names = definitions.map((item) => item.name);
  const required = ['ping', 'rules', 'setup-rules', 'setup-server', 'setup-status', 'announce', 'schedule-announcement', 'rank', 'leaderboard', 'level-rewards', 'xp-admin', 'ticket-panel', 'ticket', 'close-ticket', 'setup-roles', 'role-panel', 'setup-channels', 'channel-status', 'warn', 'warnings', 'timeout', 'kick', 'ban', 'clear', 'poll', 'event'];
  for (const name of required) assert.ok(names.includes(name), name);
  assert.equal(new Set(names).size, names.length);
  for (const item of definitions.filter((item) => item.name.startsWith('setup-') || ['xp-admin', 'role-panel', 'ticket-panel', 'stream-config'].includes(item.name))) assert.equal(item.default_member_permissions, P.Administrator.toString());
  const checkOptions = (options = []) => { let optional = false; for (const option of options) { if (option.type > 2) { if (!option.required) optional = true; else assert.equal(optional, false, 'required options precede optional options'); } checkOptions(option.options); } };
  for (const definition of definitions) checkOptions(definition.options);
});

test('SQLite state survives reopening and rollback is atomic', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'voidtide-sqlite-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.sqlite'); let store = new Store(file);
  store.set('guild', 'xp', 'member', { xp: 100 });
  assert.throws(() => store.transaction(() => { store.set('guild', 'xp', 'member', { xp: 999 }); throw new Error('rollback'); }));
  store.close(); store = new Store(file);
  assert.equal(store.get('guild', 'xp', 'member').xp, 100); store.close();
});

test('setup preview has no Discord mutations and requires a matching confirmed administrator review', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.management.execute(f.interaction('setup-server', { confirm: true })), /fresh setup preview/);
  await assert.rejects(f.management.execute(f.interaction('setup-server', {}, f.ordinary)), /permission/);
  const preview = await f.management.execute(f.interaction('setup-server'));
  assert.match(preview.content, /preview/); assert.deepEqual(f.calls, []);
  const detail = JSON.parse(preview.files[0].attachment.toString());
  assert.equal(detail.automaticDeletion, false); assert.ok(detail.roles.every((role) => !role.permissions.includes('Administrator')));
  f.addChannel('created-after-preview');
  await assert.rejects(f.management.execute(f.interaction('setup-server', { confirm: true })), /fresh setup preview/);
  assert.deepEqual(f.calls, []);
});

test('full setup is idempotent, creates no welcome channel, and keeps staff private', async (t) => {
  const f = await fixture(t); await f.setup();
  const config = configFor(f.store, f.guild.id);
  assert.equal(config.complete, true);
  assert.equal(config.xpEnabled, true);
  const baseline = [f.guild.roles.cache.size, f.guild.channels.cache.size, f.calls.filter(([type]) => type === 'send').length];
  const newcomer = f.ordinary;
  assert.equal(config.channels.welcome, undefined); assert.equal(config.welcomeEnabled, false);
  for (const name of ['📜・rules', 'general', 'choose-roles']) assert.equal(f.guild.channels.cache.get(config.channels[name]).permissionsFor(newcomer).has(P.ViewChannel), true, name);
  for (const name of ['staff-chat', 'mod-logs', 'ticket-logs']) assert.equal(f.guild.channels.cache.get(config.channels[name]).permissionsFor(newcomer).has(P.ViewChannel), false, name);
  await newcomer.roles.add(config.roles.Verified);
  assert.equal(f.guild.channels.cache.get(config.channels.general).permissionsFor(newcomer).has(P.ViewChannel), true);
  assert.equal(f.guild.channels.cache.get(config.channels['staff-chat']).permissionsFor(newcomer).has(P.ViewChannel), false);
  await f.setup();
  assert.deepEqual([f.guild.roles.cache.size, f.guild.channels.cache.size, f.calls.filter(([type]) => type === 'send').length], baseline);
  assert.ok(config.roles['Sign Language']);
  assert.match(f.guild.channels.cache.get(config.channels['gaming-chat']).topic, /Deaf, hard-of-hearing/);
});

test('public staff channels, duplicate resources, and unsafe existing roles stop setup before mutation', async (t) => {
  for (const type of ['staff', 'duplicate', 'role']) {
    const f = await fixture(t);
    if (type === 'staff') f.addChannel('staff-chat');
    if (type === 'duplicate') { f.role('Verified'); f.role('Verified'); }
    if (type === 'role') f.role('Gamer', [P.Administrator]);
    await assert.rejects(f.management.execute(f.interaction('setup-server')), UserError);
    assert.deepEqual(f.calls, []);
  }
});

test('setup separates same-named categories and channels and remains idempotent', async (t) => {
  const f = await fixture(t);
  const text = f.addChannel('gaming');
  const voice = f.addChannel('GAMING', { type: ChannelType.GuildVoice });
  const category = f.addChannel('general', { type: ChannelType.GuildCategory });
  const message = await text.send({ content: 'Existing gaming conversation' });
  f.calls.length = 0;
  const preview = await f.management.execute(f.interaction('setup-server'));
  const detail = JSON.parse(preview.files[0].attachment.toString());
  assert.deepEqual(f.calls, []);
  assert.equal(detail.existingPermissionsChanged, false);
  assert.equal(detail.channels.find((c) => c.name === "🎮 LET'S PLAY").id, null);
  await f.management.execute(f.interaction('setup-server', { confirm: true }));
  const config = configFor(f.store, f.guild.id);
  assert.equal(f.guild.channels.cache.get(config.categories.GAMING).type, ChannelType.GuildCategory);
  assert.equal(f.guild.channels.cache.get(config.channels.general).type, ChannelType.GuildText);
  assert.equal(text.type, ChannelType.GuildText); assert.equal(text.name, 'gaming');
  assert.equal(voice.type, ChannelType.GuildVoice); assert.equal(category.type, ChannelType.GuildCategory);
  assert.equal(text.messages.cache.get(message.id).content, 'Existing gaming conversation');
  assert.equal(f.calls.some(([kind]) => kind === 'rename'), false);
  const count = f.guild.channels.cache.size;
  await f.setup();
  assert.equal(f.guild.channels.cache.size, count);
  assert.equal(configFor(f.store, f.guild.id).categories.GAMING, config.categories.GAMING);
});

test('multiple matching categories remain ambiguous even beside a same-named channel', async (t) => {
  const f = await fixture(t);
  f.addChannel('gaming');
  f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  f.addChannel('gaming', { type: ChannelType.GuildCategory });
  await assert.rejects(f.management.execute(f.interaction('setup-server')), /Duplicate candidates/);
  assert.deepEqual(f.calls, []);
});

test('a saved category of the wrong type is never silently replaced', async (t) => {
  const f = await fixture(t); const text = f.addChannel('gaming');
  f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  f.store.set(f.guild.id, 'config', 'server', { categories: { GAMING: text.id } });
  await assert.rejects(f.management.execute(f.interaction('setup-server')), (error) => {
    assert.ok(error instanceof UserError);
    assert.match(error.message, /GuildText; expected GuildCategory/);
    assert.ok(error.message.includes(text.id));
    assert.match(error.message, /saved configuration/);
    return true;
  });
  assert.deepEqual(f.calls, []);
});

test('incompatible voice channels cannot replace required text channels', async (t) => {
  const f = await fixture(t); const voice = f.addChannel('gaming-chat', { type: ChannelType.GuildVoice });
  await assert.rejects(f.management.execute(f.interaction('setup-server')), (error) => {
    assert.match(error.message, /GuildVoice; expected GuildText/);
    assert.ok(error.message.includes(voice.id));
    return true;
  });
  assert.deepEqual(f.calls, []);
});

test('automatic privileged member assignments are rejected even for the owner', async (t) => {
  const f = await fixture(t);
  const selection = f.member();
  const admin = f.member(undefined, [f.role('Other administrator', [P.Administrator])]);
  await assert.rejects(f.management.execute(f.interaction('setup-roles', { badr: selection.user }, admin)), /assignments were removed/);
  await assert.rejects(f.management.execute(f.interaction('setup-roles', { badr: selection.user })), /assignments were removed/);
  assert.equal(f.calls.filter(([kind]) => kind === 'addRole').length, 0);
  await f.management.execute(f.interaction('setup-roles'));
  await f.management.execute(f.interaction('setup-roles', { confirm: true }));
  assert.equal(f.calls.some(([kind]) => kind === 'addRole'), false);
  assert.ok(f.calls.filter(([kind]) => kind === 'role').every(([, options]) => options.permissions.length === 0));
});

test('send recovery finds an existing bot panel after a lost local delivery record', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('panel');
  const payload = { embeds: [embed('Panel', 'Body')] };
  const first = await sendOnce(f.store, channel, 'panel:test', payload);
  f.store.delete(f.guild.id, 'deliveries', 'panel:test');
  const second = await sendOnce(f.store, channel, 'panel:test', payload);
  assert.equal(first.id, second.id); assert.equal(channel.messages.cache.size, 1);
});

test('tickets are private, duplicate requests reuse one channel, and closing archives without deletion', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  const request = f.interaction('ticket', { category: 'Technical Help' }, f.ordinary);
  await f.management.execute(request); await f.management.execute(request);
  const tickets = f.store.list(f.guild.id, 'tickets'); assert.equal(tickets.length, 1);
  const channel = f.guild.channels.cache.get(tickets[0].value.channelId);
  assert.equal(channel.permissionsFor(f.ordinary).has(P.ViewChannel), true);
  const other = f.member(undefined, [f.guild.roles.cache.get(config.roles.Verified)]);
  assert.equal(channel.permissionsFor(other).has(P.ViewChannel), false);
  await assert.rejects(f.management.execute(f.interaction('close-ticket', { channelId: channel.id }, other)), /requester/);
  await f.management.execute(f.interaction('close-ticket', { channelId: channel.id }, f.ordinary));
  assert.equal(f.store.list(f.guild.id, 'tickets')[0].value.status, 'closed');
  assert.equal(channel.permissionsFor(f.ordinary).has(P.SendMessages), false);
  assert.ok(f.guild.channels.cache.has(channel.id)); assert.ok(channel.messages.cache.size > 0);
});

test('self-assignable roles cannot grant privileged or private-channel permissions', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  const saved = f.store.get(f.guild.id, 'deliveries', 'panel:roles:v2');
  const request = f.interaction('role-panel', { channelId: saved.channelId, message: { id: saved.messageId } }, f.ordinary);
  await f.management.community.toggleRole(request, 'gamer');
  assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), true);
  await f.management.community.toggleRole(request, 'gamer');
  assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), false);
  f.guild.roles.cache.get(config.roles.Gamer).permissions.add(P.ManageRoles);
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /privileges/);
});

test('XP eligibility rejects short, repeated, and cooldown-farmed content and has deterministic levels', () => {
  const message = { content: 'Meaningful game discussion' };
  const first = eligibleXP(message, null, 100_000); assert.equal(first.eligible, true);
  assert.equal(eligibleXP(message, { lastAt: 99_000 }, 100_000).eligible, false);
  assert.equal(eligibleXP(message, { lastAt: 0, lastHash: first.hash }, 100_000).eligible, false);
  assert.equal(eligibleXP({ content: 'hi' }, null, 100_000).eligible, false);
  assert.equal(levelFor(2500), 5); assert.equal(levelFor(2499), 4);
});

test('XP ignores private ticket channels and persists cooldowns, levels and reward work', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  const message = { id: 'message', guildId: f.guild.id, guild: f.guild, author: f.ordinary.user, member: f.ordinary, content: 'This is a meaningful gaming conversation', channelId: config.channels.general };
  f.store.set(f.guild.id, 'xp', f.ordinary.id, { xp: 2490 });
  await f.management.community.xpMessage(message); await f.management.community.xpMessage(message);
  assert.equal(f.store.get(f.guild.id, 'xp', f.ordinary.id).xp, 2505);
  await f.management.tick();
  assert.equal(f.ordinary.roles.cache.has(config.roles['Level 5']), true);
  const before = f.store.get(f.guild.id, 'xp', f.ordinary.id).xp;
  await f.management.community.xpMessage({ ...message, channelId: config.channels['ticket-logs'], content: 'Another meaningful private message' });
  assert.equal(f.store.get(f.guild.id, 'xp', f.ordinary.id).xp, before);
});

test('scheduled announcements survive worker retry and completed sends are not duplicated', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  const key = 'scheduled-test';
  f.store.set(f.guild.id, 'jobs', key, { type: 'announcement', createdBy: f.owner.id, channelId: config.channels.announcements, payload: { embeds: [embed('Event', 'Gaming tonight')] }, runAt: 0, attempts: 0, status: 'pending' });
  const channel = f.guild.channels.cache.get(config.channels.announcements);
  const send = channel.send; let first = true;
  channel.send = async (...args) => { if (first) { first = false; throw new Error('temporary failure'); } return send(...args); };
  await f.management.tick(); assert.equal(f.store.get(f.guild.id, 'jobs', key).status, 'retry');
  f.store.set(f.guild.id, 'jobs', key, { ...f.store.get(f.guild.id, 'jobs', key), runAt: 0 });
  await f.management.tick(); await f.management.tick();
  assert.equal(f.store.get(f.guild.id, 'jobs', key).status, 'completed'); assert.equal(channel.messages.cache.size, 1);
  assert.deepEqual([...channel.messages.cache.values()][0].allowedMentions, { parse: [] });
});

test('poll voting stores one choice per member and closes against late votes', () => {
  const store = new Store(':memory:');
  try {
    store.set('g', 'polls', 'poll', { options: ['A', 'B'], votes: {}, closesAt: 1000, closed: false });
    recordVote(store, 'g', 'poll', 'member', 0, 100);
    assert.equal(recordVote(store, 'g', 'poll', 'member', 1, 200).changed, true);
    const poll = store.get('g', 'polls', 'poll'); assert.equal(Object.keys(poll.votes).length, 1);
    assert.match(pollResults(poll), /B — \*\*1/);
    assert.throws(() => recordVote(store, 'g', 'poll', 'member', 0, 1000), /closed/);
  } finally { store.close(); }
});

test('poll close worker persists results and removes voting buttons', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  const request = f.interaction('poll', { channelId: config.channels.general, question: 'Game?', options: 'A|B', closes: new Date(Date.now() + 60_000).toISOString() });
  await f.management.execute(request);
  const poll = f.store.get(f.guild.id, 'polls', request.id);
  recordVote(f.store, f.guild.id, request.id, f.ordinary.id, 1);
  const job = f.store.get(f.guild.id, 'jobs', `poll:${request.id}`);
  f.store.set(f.guild.id, 'jobs', `poll:${request.id}`, { ...job, runAt: 0 });
  await f.management.tick();
  assert.equal(f.store.get(f.guild.id, 'polls', request.id).closed, true);
  const message = f.guild.channels.cache.get(poll.channelId).messages.cache.get(poll.messageId);
  assert.deepEqual(message.components, []); assert.match(message.embeds[0].description, /B — \*\*1/);
});

test('moderation protects owners and equal/higher roles, and warnings create persistent cases', async (t) => {
  const f = await fixture(t); await f.setup();
  assert.throws(() => assertHierarchy(f.guild, f.bot, f.owner, f.bot, P.ModerateMembers), /protected/);
  const peer = f.member(undefined, [f.role('peer', [P.ModerateMembers], 10)]);
  const actor = f.member(undefined, [f.role('staff', [P.ModerateMembers], 10)]);
  assert.throws(() => assertHierarchy(f.guild, actor, peer, f.bot, P.ModerateMembers), /equal or higher/);
  const request = f.interaction('warn', { member: f.ordinary.user, reason: 'Be respectful' });
  await f.management.execute(request);
  assert.equal(f.store.get(f.guild.id, 'warnings', request.id).reason, 'Be respectful');
  await assert.rejects(f.management.execute(request), /already processed/);
});

test('anti-spam excludes staff, prevents XP farming and persists its moderation case', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  for (let n = 0; n < 6; n++) {
    await f.management.message({ id: `spam-${n}`, guildId: f.guild.id, guild: f.guild, channelId: config.channels.general, author: f.ordinary.user, member: f.ordinary, content: 'Repeated game message', deletable: false });
  }
  assert.equal(f.calls.filter(([type]) => type === 'timeout').length, 1);
  assert.equal(f.store.get(f.guild.id, 'xp', f.ordinary.id).xp, 0);
  assert.equal(f.store.list(f.guild.id, 'cases').some(({ value }) => value.type === 'anti-spam'), true);
});

test('ISO scheduling rejects missing timezones and nonexistent calendar dates', () => {
  assert.throws(() => futureTime('2027-02-30T20:00:00Z', 0), /calendar/);
  assert.throws(() => futureTime('2027-01-01T20:00:00', 0), /timezone/);
  assert.equal(futureTime('2027-01-01T20:00:00Z', Date.parse('2026-12-01T00:00:00Z')), Date.parse('2027-01-01T20:00:00Z'));
});

test('stream configuration validates provider accounts and never accepts arbitrary fetch destinations', () => {
  validateStream('twitch', 'voidtide'); validateStream('youtube', `UC${'a'.repeat(22)}`);
  for (const [provider, account] of [['twitch', 'https://localhost'], ['youtube', 'arbitrary-url'], ['unknown', 'account']]) assert.throws(() => validateStream(provider, account));
});

test('YouTube polling establishes a baseline and deduplicates uploads across service recreation', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('youtube');
  let video = 'aaaaaaaaaaa'; let now = Date.now(); const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([String(url), options.headers]);
    return { ok: true, json: async () => String(url).includes('/channels?')
      ? { items: [{ contentDetails: { relatedPlaylists: { uploads: 'playlist' } } }] }
      : { items: [{ snippet: { resourceId: { videoId: video }, title: 'Upload', channelTitle: 'VOIDTIDE' } }] } };
  };
  const account = `UC${'a'.repeat(22)}`;
  f.store.set(f.guild.id, 'streams', `youtube:${account}`, { provider: 'youtube', account, channelId: channel.id });
  const options = { store: f.store, logger: { error() {} }, environment: { YOUTUBE_API_KEY: 'test-only-key' }, fetchImpl, clock: () => now };
  await new StreamService(options).tick(f.guild); assert.equal(channel.messages.cache.size, 0);
  video = 'bbbbbbbbbbb'; now += 300_001;
  await new StreamService(options).tick(f.guild); assert.equal(channel.messages.cache.size, 1);
  now += 300_001; await new StreamService(options).tick(f.guild); assert.equal(channel.messages.cache.size, 1);
  assert.equal(requests.some(([url]) => url.includes('test-only-key')), false);
});

test('Twitch reuses provider tokens and emits one message per live stream ID', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('live'); let now = Date.now(); let tokenCalls = 0;
  const service = new StreamService({ store: f.store, logger: { error() {} }, environment: { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'test-secret' }, clock: () => now,
    fetchImpl: async (url) => ({ ok: true, json: async () => {
      if (String(url).includes('/oauth2/token')) { tokenCalls++; return { access_token: 'test-access', expires_in: 3600 }; }
      return { data: [{ id: 'live-1', user_name: 'VOIDTIDE', title: 'Gaming' }] };
    } }),
  });
  f.store.set(f.guild.id, 'streams', 'twitch:voidtide', { provider: 'twitch', account: 'voidtide', channelId: channel.id });
  await service.tick(f.guild); now += 300_001; await service.tick(f.guild);
  assert.equal(channel.messages.cache.size, 1); assert.equal(tokenCalls, 1);
});
