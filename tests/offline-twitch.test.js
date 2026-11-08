import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P, Routes } from 'discord.js';
import { digest, sendOnce } from '../src/services/management-utils.js';
import { notifyOfflineTwitch, readOfflineTwitchConfig } from '../src/services/offline-twitch.js';
import { fixture } from './helpers/community-fixture.js';

const ids = { bot: '100000000000000001', guild: '100000000000000002', channel: '100000000000000003', twitch: '100000000000000004', botRole: '100000000000000005' };
const needed = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory | P.MentionEveryone;
function offlineFixture() {
  const environment = { VOIDTIDE_OFFLINE_TWITCH_ENABLED: 'true', DISCORD_TOKEN: 'fake-test-token', DISCORD_CLIENT_ID: ids.bot, DISCORD_GUILD_ID: ids.guild,
    TWITCH_CLIENT_ID: 'fake-client', TWITCH_CLIENT_SECRET: 'fake-secret', TWITCH_LIVE_CHANNEL_ID: ids.channel, TWITCH_NOTIFICATION_ROLE_ID: ids.twitch };
  const roles = [{ id: ids.guild, name: '@everyone', position: 0, permissions: '0' },
    { id: ids.botRole, name: 'VoidToid Bot', position: 10, permissions: needed.toString() },
    { id: ids.twitch, name: 'Twitch', position: 1, managed: false, mentionable: false, permissions: '0' }];
  // The live channel is deliberately private to everyone. Only bot access is required.
  const channel = { id: ids.channel, guild_id: ids.guild, type: ChannelType.GuildText, permission_overwrites: [{ id: ids.guild, type: 0, allow: '0', deny: P.ViewChannel.toString() },
    { id: ids.botRole, type: 0, allow: needed.toString(), deny: '0' }] };
  const member = { roles: [ids.botRole] }; const channels = [channel]; const messages = []; const posts = []; const calls = [];
  let live = true; let streamId = '1234567890123'; let failAfterSend = false;
  const now = Date.now();
  const rest = { async get(route, options) {
    calls.push(['get', route]);
    if (route === Routes.user('@me')) return { id: ids.bot, bot: true };
    if (route === Routes.channel(ids.channel)) return channel;
    if (route === Routes.guildRoles(ids.guild)) return roles;
    if (route === Routes.guildChannels(ids.guild)) return channels;
    if (route === Routes.guildMember(ids.guild, ids.bot)) return member;
    if (route === Routes.channelMessages(ids.channel)) {
      const before = options.query.get('before');
      const offset = before ? messages.findIndex((message) => message.id === before) + 1 : 0;
      return messages.slice(offset, offset + 100);
    }
    throw new Error(`Unexpected route ${route}`);
  }, async post(route, { body }) {
    assert.equal(route, Routes.channelMessages(ids.channel)); posts.push(body);
    const message = { id: String(100000000000000100n + BigInt(messages.length)), author: { id: ids.bot }, timestamp: new Date(now).toISOString(), ...body };
    messages.unshift(message);
    if (failAfterSend) { failAfterSend = false; throw new Error('Lost Discord response'); }
    return message;
  } };
  const fetchImpl = async (url, options) => {
    const address = String(url); calls.push(['fetch', address]);
    if (address === 'https://id.twitch.tv/oauth2/token') {
      assert.equal(options.method, 'POST'); assert.match(options.body, /client_credentials/);
      return { ok: true, json: async () => ({ access_token: 'fake-access-token', expires_in: 3600 }) };
    }
    assert.equal(address, 'https://api.twitch.tv/helix/streams?user_login=voidtideus');
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    return { ok: true, json: async () => ({ data: live ? [{ id: streamId, user_name: 'VOIDTIDE', title: 'Gaming @everyone @here <@100000000000000009>' }] : [] }) };
  };
  const run = (overrides = {}) => notifyOfflineTwitch({ environment, rest, fetchImpl, clock: () => now, ...overrides });
  return { environment, roles, channel, channels, member, messages, posts, calls, rest, fetchImpl, now, run,
    setLive(value) { live = value; }, setStreamId(value) { streamId = value; }, loseNextResponse() { failAfterSend = true; } };
}

test('offline notifier is disabled by default and does not touch credentials, Discord or Twitch', async () => {
  const f = offlineFixture(); delete f.environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED;
  assert.equal(readOfflineTwitchConfig({}), null); assert.deepEqual(await f.run(), { status: 'disabled' }); assert.deepEqual(f.calls, []);
});

test('enabled configuration validates IDs, login, cooldown and credentials without echoing values', () => {
  const f = offlineFixture(); assert.equal(readOfflineTwitchConfig(f.environment).account, 'voidtideus');
  for (const [name, value] of [['DISCORD_CLIENT_ID', 'invalid-sensitive-value'], ['TWITCH_LIVE_CHANNEL_ID', '0'], ['TWITCH_NOTIFICATION_ROLE_ID', '18446744073709551616'],
    ['TWITCH_LOGIN', 'https://twitch.tv/voidtideus'], ['TWITCH_ALERT_COOLDOWN_MINUTES', '0'], ['TWITCH_CLIENT_SECRET', '']]) {
    assert.throws(() => readOfflineTwitchConfig({ ...f.environment, [name]: value }), (error) => !error.message.includes('invalid-sensitive-value'));
  }
});

test('an offline stream validates access but posts no notification', async () => {
  const f = offlineFixture(); f.setLive(false);
  assert.deepEqual(await f.run(), { status: 'offline' }); assert.equal(f.posts.length, 0);
  assert.equal(f.calls.filter(([kind]) => kind === 'fetch').length, 2);
});

test('a live stream posts as the existing bot using REST, even in a private live channel, with only the Twitch opt-in ping', async () => {
  const f = offlineFixture(); assert.deepEqual(await f.run(), { status: 'posted' }); assert.equal(f.posts.length, 1);
  const payload = f.posts[0]; const key = 'stream:twitch:voidtideus:1234567890123';
  assert.equal(payload.content, `<@&${ids.twitch}>`); assert.deepEqual(payload.allowed_mentions, { parse: [], roles: [ids.twitch], users: [], replied_user: false });
  assert.equal(payload.embeds[0].url, 'https://www.twitch.tv/voidtideus'); assert.match(payload.embeds[0].description, /@everyone/);
  assert.equal(payload.embeds[0].footer.text, `VOIDTIDE • ${key}`);
  assert.equal(payload.nonce, BigInt(`0x${digest(key).slice(0, 16)}`).toString()); assert.equal(payload.enforce_nonce, true);
  assert.equal(f.calls.some(([, route]) => String(route).includes('gateway')), false);
});

test('a fresh scheduled invocation recovers the same stream after a lost send response', async () => {
  const f = offlineFixture(); f.loseNextResponse(); await assert.rejects(f.run(), /Lost Discord response/);
  assert.deepEqual(await f.run(), { status: 'duplicate' }); assert.equal(f.posts.length, 1);
  f.setStreamId('1234567890999'); assert.deepEqual(await f.run(), { status: 'cooldown' }); assert.equal(f.posts.length, 1);
  assert.deepEqual(await f.run({ clock: () => f.now + 300_001 }), { status: 'posted' }); assert.equal(f.posts.length, 2);
});

test('history recovery paginates beyond the newest 100 messages and ignores copied member messages', async () => {
  const f = offlineFixture();
  const marker = { footer: { text: 'VOIDTIDE • stream:twitch:voidtideus:1234567890123' } };
  for (let i = 0; i < 101; i++) f.messages.push({ id: String(100000000000000200n + BigInt(i)), author: { id: 'another-member' }, timestamp: new Date(f.now).toISOString(), embeds: [marker] });
  f.messages.push({ id: '100000000000000999', author: { id: ids.bot }, timestamp: new Date(f.now - 86400_000).toISOString(), embeds: [marker] });
  assert.deepEqual(await f.run(), { status: 'duplicate' }); assert.equal(f.posts.length, 0);
  assert.equal(f.calls.filter(([, route]) => route === Routes.channelMessages(ids.channel)).length, 2);
  f.messages.pop(); assert.deepEqual(await f.run(), { status: 'posted' });
});

test('wrong bot/guild/type, privileged/managed/high roles and channel-grant roles cannot trigger alerts', async () => {
  for (const problem of ['guild', 'type', 'privileged', 'managed', 'high', 'staff-name', 'channel-grant', 'wrong-bot']) {
    const f = offlineFixture();
    if (problem === 'guild') f.channel.guild_id = '100000000000000999';
    if (problem === 'type') f.channel.type = ChannelType.GuildVoice;
    if (problem === 'privileged') f.roles[2].permissions = P.Administrator.toString();
    if (problem === 'managed') f.roles[2].managed = true;
    if (problem === 'high') f.roles[2].position = 10;
    if (problem === 'staff-name') f.roles[2].name = 'Founder';
    if (problem === 'channel-grant') f.channels.push({ permission_overwrites: [{ id: ids.twitch, allow: P.ViewChannel.toString(), deny: '0' }] });
    if (problem === 'wrong-bot') { const get = f.rest.get; f.rest.get = (route, options) => route === Routes.user('@me') ? { id: '100000000000000999', bot: true } : get(route, options); }
    await assert.rejects(f.run()); assert.equal(f.posts.length, 0); assert.equal(f.calls.some(([kind]) => kind === 'fetch'), false);
  }
});

test('effective role and member overwrites are respected and ping permission is never granted automatically', async () => {
  const f = offlineFixture();
  f.channel.permission_overwrites.push({ id: ids.bot, type: 1, allow: '0', deny: P.SendMessages.toString() });
  await assert.rejects(f.run(), /Send Messages/); assert.equal(f.posts.length, 0);
  f.channel.permission_overwrites.pop();
  f.roles[1].permissions = (needed & ~P.MentionEveryone).toString(); f.channel.permission_overwrites[1].allow = f.roles[1].permissions;
  await assert.rejects(f.run(), /Mention Everyone/); assert.equal(f.posts.length, 0);
  f.roles[2].mentionable = true; assert.deepEqual(await f.run(), { status: 'posted' });
  assert.equal(f.calls.some(([kind]) => !['get', 'fetch'].includes(kind)), false);
});

test('Twitch authorization errors, malformed stream IDs and history failures send no alert', async () => {
  const f = offlineFixture();
  await assert.rejects(f.run({ fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  f.setStreamId('not-a-valid-id'); await assert.rejects(f.run(), /invalid stream ID/);
  f.setStreamId('1234567890123');
  const get = f.rest.get;
  f.rest.get = (route, options) => { if (route === Routes.channelMessages(ids.channel)) throw new Error('History denied'); return get(route, options); };
  await assert.rejects(f.run(), /History denied/); assert.equal(f.posts.length, 0);
});

test('the gateway bot adopts an alert posted while its SQLite was offline instead of sending it twice', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('🔴・live-now'); const key = 'stream:twitch:voidtideus:1234567890123';
  const existing = await channel.send({ embeds: [{ title: 'VOIDTIDE is live', footer: { text: `VOIDTIDE • ${key}` } }] });
  assert.equal(f.store.get(f.guild.id, 'deliveries', key), null);
  const recovered = await sendOnce(f.store, channel, key, { embeds: [{ title: 'Same live event' }] });
  assert.equal(recovered.id, existing.id); assert.equal(channel.messages.cache.size, 1);
  assert.equal(f.store.get(f.guild.id, 'deliveries', key).messageId, existing.id);
});
