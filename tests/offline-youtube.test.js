import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P, Routes } from 'discord.js';
import { digest, sendOnce } from '../src/services/management-utils.js';
import { notifyOfflineYouTube, readOfflineYouTubeConfig } from '../src/services/offline-youtube.js';
import { fixture } from './helpers/community-fixture.js';

const ids = { bot: '100000000000000001', guild: '100000000000000002', channel: '100000000000000003', youtube: '100000000000000004', botRole: '100000000000000005' };
const account = `UC${'a'.repeat(22)}`; const playlist = `UU${'a'.repeat(22)}`;
const needed = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory | P.MentionEveryone;
function youtubeFixture() {
  const environment = { VOIDTIDE_OFFLINE_YOUTUBE_ENABLED: 'true', DISCORD_TOKEN: 'fake-test-token', DISCORD_CLIENT_ID: ids.bot, DISCORD_GUILD_ID: ids.guild,
    YOUTUBE_API_KEY: 'fake-youtube-key', YOUTUBE_DISCORD_CHANNEL_ID: ids.channel, YOUTUBE_NOTIFICATION_ROLE_ID: ids.youtube };
  const roles = [{ id: ids.guild, name: '@everyone', position: 0, permissions: '0' },
    { id: ids.botRole, name: 'VoidToid Bot', position: 10, permissions: needed.toString() },
    { id: ids.youtube, name: '▶️ YouTube', position: 1, managed: false, mentionable: false, permissions: '0' }];
  const channel = { id: ids.channel, guild_id: ids.guild, type: ChannelType.GuildText, permission_overwrites: [
    { id: ids.guild, type: 0, allow: '0', deny: P.ViewChannel.toString() }, { id: ids.botRole, type: 0, allow: needed.toString(), deny: '0' }] };
  const member = { roles: [ids.botRole] }; const channels = [channel]; const messages = []; const posts = []; const calls = [];
  let now = Date.now(); let loseResponse = false; let sequence = 100000000000001000n;
  const video = (id, publishedAt = now - 86400_000, overrides = {}) => ({ id, status: { privacyStatus: 'public' }, snippet: {
    channelId: account, title: `VOIDTIDE video ${id}`, description: 'Video description @everyone @here <@100000000000000009>', publishedAt: new Date(publishedAt).toISOString(),
    liveBroadcastContent: 'none', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } }, ...overrides });
  let videos = [video('aaaaaaaaaaa')];
  const rest = { async get(route, options) {
    calls.push(['get', route]);
    if (route === Routes.user('@me')) return { id: ids.bot, bot: true };
    if (route === Routes.channel(ids.channel)) return channel;
    if (route === Routes.guildRoles(ids.guild)) return roles;
    if (route === Routes.guildChannels(ids.guild)) return channels;
    if (route === Routes.guildMember(ids.guild, ids.bot)) return member;
    if (route === Routes.channelMessages(ids.channel)) {
      const before = options.query.get('before'); const offset = before ? messages.findIndex((message) => message.id === before) + 1 : 0;
      return messages.slice(offset, offset + 100);
    }
    throw new Error(`Unexpected route ${route}`);
  }, async post(route, { body }) {
    assert.equal(route, Routes.channelMessages(ids.channel)); posts.push(body);
    messages.unshift({ id: String(sequence++), author: { id: ids.bot }, timestamp: new Date(now).toISOString(), ...body });
    if (loseResponse) { loseResponse = false; throw new Error('Lost YouTube alert response'); }
    return messages[0];
  } };
  const fetchImpl = async (url, options) => {
    calls.push(['fetch', url.toString()]);
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.headers['X-Goog-Api-Key'], environment.YOUTUBE_API_KEY);
    let result;
    if (url.pathname.endsWith('/channels')) {
      assert.equal(url.searchParams.get('forHandle'), '@VoidtidePASV');
      result = { items: [{ id: account, contentDetails: { relatedPlaylists: { uploads: playlist } } }] };
    } else if (url.pathname.endsWith('/playlistItems')) {
      assert.equal(url.searchParams.get('playlistId'), playlist); assert.equal(url.searchParams.get('maxResults'), '50');
      result = { items: videos.map((item) => ({ contentDetails: { videoId: item.id } })) };
    } else {
      assert.ok(url.pathname.endsWith('/videos')); assert.equal(url.searchParams.get('part'), 'snippet,status'); result = { items: videos };
    }
    return { ok: true, json: async () => result };
  };
  const run = (overrides = {}) => notifyOfflineYouTube({ environment, rest, fetchImpl, clock: () => now, ...overrides });
  return { environment, roles, channel, channels, member, messages, posts, calls, rest, fetchImpl, run, video,
    setVideos(value) { videos = value; }, advance(milliseconds = 300_001) { now += milliseconds; }, now: () => now,
    loseNextResponse() { loseResponse = true; } };
}

test('YouTube stays disabled without explicit opt-in and requires no Twitch configuration', async () => {
  const f = youtubeFixture(); assert.equal(readOfflineYouTubeConfig({}), null);
  assert.deepEqual(await f.run({ environment: {} }), { status: 'disabled' }); assert.deepEqual(f.calls, []);
  assert.equal(readOfflineYouTubeConfig(f.environment).handle, '@VoidtidePASV');
  assert.deepEqual(await f.run(), { status: 'posted' });
});

test('YouTube configuration errors identify names, never credential values', () => {
  const f = youtubeFixture();
  for (const [name, value] of [['YOUTUBE_API_KEY', ''], ['YOUTUBE_HANDLE', 'https://www.youtube.com/@VoidtidePASV'],
    ['YOUTUBE_DISCORD_CHANNEL_ID', '0'], ['YOUTUBE_NOTIFICATION_ROLE_ID', '18446744073709551616'], ['YOUTUBE_ALERT_COOLDOWN_MINUTES', '0'], ['VOIDTIDE_OFFLINE_YOUTUBE_ENABLED', 'yes']]) {
    assert.throws(() => readOfflineYouTubeConfig({ ...f.environment, [name]: value }), (error) => !error.message.includes('fake-youtube-key') && !error.message.includes('fake-test-token'));
  }
});

test('first check posts only the latest video with title, large thumbnail, description, URL and exact opt-in mention', async () => {
  const f = youtubeFixture(); f.setVideos([f.video('aaaaaaaaaaa'), f.video('bbbbbbbbbbb', f.now() - 172800_000)]);
  assert.deepEqual(await f.run(), { status: 'posted' }); assert.equal(f.posts.length, 1);
  const body = f.posts[0]; const key = `stream:youtube:${account}:aaaaaaaaaaa`; const panel = body.embeds[0];
  assert.equal(body.content, `<@&${ids.youtube}>`); assert.deepEqual(body.allowed_mentions, { parse: [], roles: [ids.youtube], users: [], replied_user: false });
  assert.equal(panel.title, '▶️ VOIDTIDE video aaaaaaaaaaa'); assert.match(panel.description, /Video description @everyone @here/);
  assert.match(panel.description, /https:\/\/www.youtube.com\/watch\?v=aaaaaaaaaaa/); assert.equal(panel.url, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
  assert.equal(panel.image.url, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg'); assert.equal(panel.footer.text, `VOIDTIDE • ${key}`);
  assert.equal(body.nonce, BigInt(`0x${digest(key).slice(0, 16)}`).toString()); assert.equal(body.enforce_nonce, true);
  assert.deepEqual(await f.run(), { status: 'duplicate' }); assert.equal(f.posts.length, 1);
});

test('subsequent uploads catch up oldest first, one per check, without reposting old videos', async () => {
  const f = youtubeFixture(); await f.run(); f.advance();
  f.setVideos([f.video('ccccccccccc', f.now() - 1000), f.video('bbbbbbbbbbb', f.now() - 2000), f.video('aaaaaaaaaaa')]);
  assert.deepEqual(await f.run(), { status: 'posted' }); assert.match(f.posts[1].embeds[0].url, /bbbbbbbbbbb/);
  assert.deepEqual(await f.run(), { status: 'cooldown' }); f.advance();
  assert.deepEqual(await f.run(), { status: 'posted' }); assert.match(f.posts[2].embeds[0].url, /ccccccccccc/);
  f.advance(); assert.deepEqual(await f.run(), { status: 'duplicate' }); assert.equal(f.posts.length, 3);
});

test('lost Discord responses and new invocations recover the alert from durable Discord history', async () => {
  const f = youtubeFixture(); f.loseNextResponse(); await assert.rejects(f.run(), /Lost YouTube alert response/);
  assert.equal(f.posts.length, 1);
  const result = await notifyOfflineYouTube({ environment: f.environment, rest: f.rest, fetchImpl: f.fetchImpl, clock: f.now });
  assert.deepEqual(result, { status: 'duplicate' }); assert.equal(f.posts.length, 1);
});

test('empty, private, unlisted, future, upcoming and foreign-channel videos are not published', async () => {
  const f = youtubeFixture(); f.setVideos([]); assert.deepEqual(await f.run(), { status: 'empty' });
  const privateVideo = f.video('aaaaaaaaaaa', undefined, { status: { privacyStatus: 'private' } });
  const unlisted = f.video('bbbbbbbbbbb', undefined, { status: { privacyStatus: 'unlisted' } });
  const future = f.video('ccccccccccc', f.now() + 3600_000);
  const upcoming = f.video('ddddddddddd'); upcoming.snippet.liveBroadcastContent = 'upcoming';
  const foreign = f.video('eeeeeeeeeee'); foreign.snippet.channelId = `UC${'b'.repeat(22)}`;
  f.setVideos([privateVideo, unlisted, future, upcoming, foreign]);
  assert.deepEqual(await f.run(), { status: 'empty' }); assert.equal(f.posts.length, 0);
});

test('untrusted thumbnail URLs fall back to YouTube images and long descriptions fit Discord embeds', async () => {
  const f = youtubeFixture(); const item = f.video('aaaaaaaaaaa');
  item.snippet.thumbnails = { maxres: { url: 'https://attacker.example/image.png' }, high: { url: 'http://i.ytimg.com/image.png' } };
  item.snippet.description = 'A'.repeat(9000); item.snippet.title = 'B'.repeat(500); f.setVideos([item]);
  await f.run(); const panel = f.posts[0].embeds[0];
  assert.equal(panel.image.url, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  assert.ok(panel.title.length <= 256); assert.ok(panel.description.length <= 4096);
});

test('YouTube only pings its safe platform role and respects private channel/member overwrites', async () => {
  for (const problem of ['wrong-role', 'privileged', 'managed', 'high', 'grant', 'permission', 'ping']) {
    const f = youtubeFixture();
    if (problem === 'wrong-role') f.roles[2].name = 'Twitch';
    if (problem === 'privileged') f.roles[2].permissions = P.ManageRoles.toString();
    if (problem === 'managed') f.roles[2].managed = true;
    if (problem === 'high') f.roles[2].position = 10;
    if (problem === 'grant') f.channels.push({ permission_overwrites: [{ id: ids.youtube, allow: P.ViewChannel.toString() }] });
    if (problem === 'permission') f.channel.permission_overwrites.push({ id: ids.bot, type: 1, allow: '0', deny: P.SendMessages.toString() });
    if (problem === 'ping') { f.roles[1].permissions = (needed & ~P.MentionEveryone).toString(); f.channel.permission_overwrites[1].allow = f.roles[1].permissions; }
    await assert.rejects(f.run()); assert.equal(f.posts.length, 0); assert.equal(f.calls.some(([kind]) => kind === 'fetch'), false);
  }
});

test('official API errors and denied history stop delivery without exposing API keys', async () => {
  const f = youtubeFixture();
  await assert.rejects(f.run({ fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(f.run({ fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) }), /could not be resolved/);
  const get = f.rest.get; f.rest.get = (route, options) => { if (route === Routes.channelMessages(ids.channel)) throw new Error('History access denied'); return get(route, options); };
  await assert.rejects(f.run(), /History access denied/); assert.equal(f.posts.length, 0);
});

test('member-copied markers are ignored and actual bot markers recover across history pages', async () => {
  const f = youtubeFixture(); const marker = { footer: { text: `VOIDTIDE • stream:youtube:${account}:aaaaaaaaaaa` } };
  for (let index = 0; index < 101; index++) f.messages.push({ id: String(100000000000002000n + BigInt(index)), author: { id: 'another-member' }, embeds: [marker] });
  f.messages.push({ id: '100000000000009999', author: { id: ids.bot }, timestamp: new Date(f.now() - 86400_000).toISOString(), embeds: [marker] });
  assert.deepEqual(await f.run(), { status: 'duplicate' }); assert.equal(f.posts.length, 0);
  f.messages.pop(); assert.deepEqual(await f.run(), { status: 'posted' });
});

test('the regular bot adopts YouTube messages posted by the offline worker using the same canonical key', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('▶️・youtube'); const key = `stream:youtube:${account}:aaaaaaaaaaa`;
  const existing = await channel.send({ embeds: [{ title: 'New YouTube video', footer: { text: `VOIDTIDE • ${key}` } }] });
  assert.equal(f.store.get(f.guild.id, 'deliveries', key), null);
  const recovered = await sendOnce(f.store, channel, key, { embeds: [{ title: 'Same upload' }] });
  assert.equal(recovered.id, existing.id); assert.equal(channel.messages.cache.size, 1);
});
