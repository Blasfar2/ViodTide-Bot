import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { ChannelType, MessageFlags, PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../src/database/store.js';
import { COUNTRY_ROLES, SOCIAL_ROLES, PROFILE_LAYOUT, PANEL_CHANNELS, PANEL_KEYS } from '../src/config/profile.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { handleInteraction } from '../src/events/interaction-create.js';
import { Management } from '../src/services/management.js';
import { configFor } from '../src/services/management-utils.js';
import { SocialNotifications } from '../src/services/social-notifications.js';
import { StreamService } from '../src/services/stream-service.js';
import { fixture } from './helpers/community-fixture.js';

const tokenFor = (reply) => reply.components[0].toJSON().components[0].custom_id.split(':').at(-1);
async function profileSetup(f) {
  const reply = await f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' });
  return f.management.profileAdmin.confirm(f.interaction('manage-server'), tokenFor(reply));
}
function selection(f, group, actor = f.ordinary) {
  const panel = f.store.get(f.guild.id, 'deliveries', PANEL_KEYS[group]);
  return f.interaction('manage-server', { channelId: panel.channelId, message: { id: panel.messageId } }, actor);
}
function routed(f, customId, options = {}) {
  const calls = []; const { actor = f.owner, type = 'button', ...overrides } = options;
  return { ...f.interaction('manage-server', {}, actor), customId, calls,
    isButton: () => type === 'button', isStringSelectMenu: () => type === 'select', isModalSubmit: () => type === 'modal', isChatInputCommand: () => false, inGuild: () => true,
    async deferReply(payload) { calls.push(['defer', payload]); this.deferred = true; },
    async editReply(payload) { calls.push(['edit', payload]); this.replied = true; },
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    async followUp(payload) { calls.push(['followUp', payload]); },
    async showModal(modal) { calls.push(['modal', modal.toJSON()]); }, ...overrides,
  };
}
const dispatch = (f, request) => handleInteraction(request, { commands: new Map(), guildId: f.guild.id, logger: { error() {} }, rulesService: f.rulesService, management: f.management });

test('manage-server is admin-only and previews exact additive resources and new permissions without Discord mutations', async (t) => {
  const data = getCommandDefinitions().find((c) => c.name === 'manage-server');
  assert.equal(data.default_member_permissions, P.Administrator.toString());
  const f = await fixture(t);
  const reply = await f.management.execute(f.interaction('manage-server'));
  assert.equal(reply.components.flatMap((row) => row.toJSON().components).length, 6);
  await assert.rejects(f.management.execute(f.interaction('manage-server', {}, f.ordinary)), /permission/);
  await assert.rejects(f.management.profileAdmin.review(f.interaction('manage-server', {}, f.ordinary), { type: 'setup' }), /permission/);
  const review = await f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' });
  const plan = JSON.parse(review.files[0].attachment);
  assert.equal(plan.channels.length, 10); assert.equal(plan.roles.length, 24);
  assert.equal(plan.existingPermissionsChanged, false); assert.equal(plan.deletion, false);
  assert.deepEqual(plan.newChannelPermissions.everyone.allow, ['ViewChannel', 'ReadMessageHistory']);
  assert.deepEqual(f.calls, []); assert.equal(configFor(f.store, f.guild.id).profile, undefined);
});

test('confirmed setup reuses existing channels/panel and preserves every overwrite, existing feature record and unrelated resource', async (t) => {
  const f = await fixture(t); await f.setup();
  const before = configFor(f.store, f.guild.id); const community = f.store.get(f.guild.id, 'deliveries', PANEL_KEYS.community);
  const welcome = f.addChannel('existing-welcome'); const staff = before.channels['staff-chat'];
  for (const namespace of ['xp', 'tickets', 'cases', 'jobs', 'streams']) f.store.set(f.guild.id, namespace, 'kept', { marker: namespace });
  const overwrites = [...f.guild.channels.cache.values()].map((c) => [c.id, [...c.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield])]);
  const rulesState = await f.rulesService.store.get(f.guild.id); const start = f.calls.length;
  await profileSetup(f);
  const config = configFor(f.store, f.guild.id);
  for (const [category, children] of PROFILE_LAYOUT) {
    assert.equal(f.guild.channels.cache.get(config.profile.categories[category]).name, category);
    for (const [key, name] of children) assert.equal(f.guild.channels.cache.get(config.channels[key]).name, name);
  }
  assert.equal(config.channels['choose-roles'], community.channelId);
  assert.equal(f.store.get(f.guild.id, 'deliveries', PANEL_KEYS.community).messageId, community.messageId);
  assert.equal(config.channels['staff-chat'], staff); assert.equal(f.guild.channels.cache.has(welcome.id), true);
  for (const [id, expected] of overwrites) assert.deepEqual([...f.guild.channels.cache.get(id).permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield]), expected);
  assert.equal(f.calls.slice(start).some(([kind]) => ['overwrite', 'deleteChannel', 'addRole', 'removeRole'].includes(kind)), false);
  assert.deepEqual(await f.rulesService.store.get(f.guild.id), rulesState);
  for (const namespace of ['xp', 'tickets', 'cases', 'jobs', 'streams']) assert.deepEqual(f.store.get(f.guild.id, namespace, 'kept'), { marker: namespace });
  assert.equal([...f.guild.channels.cache.values()].filter((c) => c.name === '🔴・live-now').length, 1);
});

test('repeated setup/refresh creates no duplicate roles, channels or messages; old setup preserves the profile destinations', async (t) => {
  const f = await fixture(t); await f.setup(); await profileSetup(f);
  const config = configFor(f.store, f.guild.id);
  const messages = Object.values(PANEL_KEYS).map((key) => f.store.get(f.guild.id, 'deliveries', key).messageId);
  const counts = [f.guild.roles.cache.size, f.guild.channels.cache.size]; const sends = f.calls.filter(([kind]) => kind === 'send').length;
  await profileSetup(f); await f.management.profiles.publish(f.guild); await f.setup();
  assert.deepEqual([f.guild.roles.cache.size, f.guild.channels.cache.size], counts);
  assert.equal(f.calls.filter(([kind]) => kind === 'send').length, sends);
  assert.deepEqual(Object.values(PANEL_KEYS).map((key) => f.store.get(f.guild.id, 'deliveries', key).messageId), messages);
  assert.equal(f.guild.channels.cache.get(config.channels['choose-roles']).name, '🎭・choose-your-roles');
  assert.equal(f.guild.channels.cache.get(config.channels['live-now']).parentId, config.profile.categories['🔴 VOIDTIDE LIVE & SOCIALS']);
});

test('all panel components serialize within Discord limits with approved titles and no member country defaults', async (t) => {
  const f = await fixture(t); await profileSetup(f);
  const titles = ['🌌 VOIDTIDE | Choose Your Roles', '🔔 VOIDTIDE | Pick Your Notification Roles', '🌍 VOIDTIDE | Where Are You From?'];
  for (const [index, group] of Object.keys(PANEL_KEYS).entries()) {
    const panel = f.store.get(f.guild.id, 'deliveries', PANEL_KEYS[group]);
    const channel = f.guild.channels.cache.get(panel.channelId); const message = channel.messages.cache.get(panel.messageId);
    assert.equal(message.embeds[0].title, titles[index]); assert.deepEqual(message.allowedMentions, { parse: [] });
    assert.ok(message.components.length <= 5);
    if (group !== 'community') {
      const menu = message.components[0].components[0]; assert.ok(menu.options.length <= 25);
      assert.equal(menu.max_values, group === 'country' ? 1 : 5); assert.equal(menu.min_values, 0);
      assert.equal(menu.options.some((option) => option.default), false);
    }
  }
});

test('members add/remove community roles and replace or clear multiple social preferences without verification privilege', async (t) => {
  const f = await fixture(t); await profileSetup(f); const config = configFor(f.store, f.guild.id);
  const request = selection(f, 'community');
  await f.management.community.toggleRole(request, 'gamer'); assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), true);
  await f.management.community.toggleRole(request, 'gamer'); assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), false);
  const social = selection(f, 'social');
  await f.management.profiles.select(social, 'social', ['youtube', 'twitch']);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['social:youtube']), true);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['social:twitch']), true);
  await f.management.profiles.select(social, 'social', ['instagram']);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['social:youtube']), false);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['social:instagram']), true);
  await f.management.profiles.select(social, 'social', []);
  assert.equal(SOCIAL_ROLES.some((c) => f.ordinary.roles.cache.has(config.profile.roles[`social:${c.key}`])), false);
});

test('changing and clearing country roles affects only the country group and stores no member-to-country records', async (t) => {
  const f = await fixture(t); await profileSetup(f); const config = configFor(f.store, f.guild.id);
  await f.management.community.toggleRole(selection(f, 'community'), 'sign-language');
  const request = selection(f, 'country');
  await f.management.profiles.select(request, 'country', ['ma']);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ma']), true);
  await f.management.profiles.select(request, 'country', ['ca']);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ma']), false);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ca']), true);
  await f.management.profiles.select(request, 'country', []);
  assert.equal(COUNTRY_ROLES.some((c) => f.ordinary.roles.cache.has(config.profile.roles[`country:${c.key}`])), false);
  assert.equal(f.ordinary.roles.cache.has(config.roles['Sign Language']), true);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM documents WHERE key=?').get(f.ordinary.id).count, 0);
});

test('concurrent country changes serialize and failed country assignment restores the prior role', async (t) => {
  const f = await fixture(t); await profileSetup(f); const config = configFor(f.store, f.guild.id); const request = selection(f, 'country');
  await Promise.all([f.management.profiles.select(request, 'country', ['ma']), f.management.profiles.select(request, 'country', ['fr'])]);
  assert.equal(COUNTRY_ROLES.filter((c) => f.ordinary.roles.cache.has(config.profile.roles[`country:${c.key}`])).length, 1);
  const add = f.ordinary.roles.add; f.ordinary.roles.add = async (role, reason) => { if (role.id === config.profile.roles['country:ca']) throw new Error('Discord refused assignment'); return add(role, reason); };
  await assert.rejects(f.management.profiles.select(request, 'country', ['ca']), /refused/);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:fr']), true);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ca']), false);
});

test('public choices reject forged role IDs, copied panels, privileged/managed/high/channel-grant/staff-name roles and pending members', async (t) => {
  const f = await fixture(t); await profileSetup(f); const request = selection(f, 'social');
  const config = configFor(f.store, f.guild.id); const role = f.guild.roles.cache.get(config.profile.roles['social:youtube']);
  await assert.rejects(f.management.profiles.select(request, 'social', [f.owner.roles.highest.id]), /options/);
  await assert.rejects(f.management.profiles.select({ ...request, message: { id: 'copied' } }, 'social', ['youtube']), /current/);
  for (const property of ['privileged', 'managed', 'high', 'grant', 'staff-name']) {
    const before = f.calls.length;
    if (property === 'privileged') role.permissions.add(P.Administrator);
    if (property === 'managed') role.managed = true;
    if (property === 'high') role.position = 100;
    if (property === 'grant') f.addChannel('private-access', { permissionOverwrites: [{ id: role.id, allow: [P.ViewChannel] }] });
    if (property === 'staff-name') role.name = 'Founder';
    await assert.rejects(f.management.profiles.select(request, 'social', ['youtube']));
    assert.equal(f.calls.slice(before).some(([kind]) => ['addRole', 'removeRole'].includes(kind)), false);
    role.permissions.remove(P.Administrator); role.managed = false; role.position = 1; role.name = 'YouTube';
    if (property === 'grant') for (const channel of f.guild.channels.cache.values()) channel.permissionOverwrites.cache.delete(role.id);
  }
  f.ordinary.pending = true; await assert.rejects(f.management.profiles.select(request, 'social', ['youtube']), /screening/); f.ordinary.pending = false;
  f.botRole.permissions.remove(P.ManageRoles); await assert.rejects(f.management.profiles.select(request, 'social', ['youtube']), /Manage Roles/);
});

test('public panels work after closing and reopening the database and constructing a fresh management service', async (t) => {
  const f = await fixture(t); await profileSetup(f); const before = configFor(f.store, f.guild.id);
  await f.management.profiles.select(selection(f, 'country'), 'country', ['ma']);
  const socialRequest = selection(f, 'social'); const countryRequest = selection(f, 'country');
  const preview = await f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'refresh' });
  await f.management.shutdown();
  const reopened = new Store(join(f.directory, 'community.sqlite'));
  const restarted = new Management({ client: f.client, guildId: f.guild.id, logger: { error() {} }, rulesService: f.rulesService, store: reopened, environment: {} });
  try {
    assert.equal(f.ordinary.roles.cache.has(before.profile.roles['country:ma']), true);
    await restarted.profiles.select(countryRequest, 'country', ['de']);
    await restarted.profiles.select(socialRequest, 'social', ['twitch']);
    await restarted.community.toggleRole(selection({ ...f, store: reopened }, 'community'), 'gamer');
    await restarted.profileAdmin.confirm(f.interaction('manage-server'), tokenFor(preview));
    assert.equal(f.ordinary.roles.cache.has(before.profile.roles['country:ma']), false);
    assert.equal(f.ordinary.roles.cache.has(before.profile.roles['country:de']), true);
    assert.equal(f.ordinary.roles.cache.has(before.roles.Gamer), true);
  } finally { await restarted.shutdown(); }
});

test('admin confirmations enforce actor, current permissions, expiry, snapshot, cancellation and single use', async (t) => {
  const f = await fixture(t); const admin = f.management.profileAdmin;
  let reply = await admin.review(f.interaction('manage-server'), { type: 'setup' }); let token = tokenFor(reply);
  const other = f.member(undefined, [f.role('second admin', [P.Administrator])]);
  await assert.rejects(admin.confirm(f.interaction('manage-server', {}, other), token), /another administrator/);
  await assert.rejects(admin.confirm(f.interaction('manage-server', {}, f.ordinary), token), /permission/);
  await assert.rejects(admin.confirm(f.interaction('manage-server'), token), /changed/);
  reply = await admin.review(f.interaction('manage-server'), { type: 'setup' }); token = tokenFor(reply);
  const saved = f.store.get(f.guild.id, 'admin-reviews', token); f.store.set(f.guild.id, 'admin-reviews', token, { ...saved, expires: 0 });
  await assert.rejects(admin.confirm(f.interaction('manage-server'), token), /expired/);
  reply = await admin.review(f.interaction('manage-server'), { type: 'setup' }); token = tokenFor(reply);
  await admin.confirm(f.interaction('manage-server'), token, true);
  await assert.rejects(admin.confirm(f.interaction('manage-server'), token), /already used/);
  assert.deepEqual(f.calls, []);
  reply = await admin.review(f.interaction('manage-server'), { type: 'setup' }); token = tokenFor(reply);
  await admin.confirm(f.interaction('manage-server'), token);
  await assert.rejects(admin.confirm(f.interaction('manage-server'), token), /already used/);
});

test('router opens administrator modals before deferring and confirms channel/role name edits without permission edits', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('old-name'); const role = f.role('safe-name');
  for (const kind of ['channel', 'role']) {
    const open = routed(f, `voidtide:manage:${kind}-form`); await dispatch(f, open);
    assert.equal(open.calls[0][0], 'modal'); assert.equal(open.calls.length, 1);
    assert.equal(open.calls[0][1].components.length, 2);
    const submit = routed(f, `voidtide:manage:${kind}-form-submit`, { type: 'modal', fields: { getTextInputValue: (key) => key === 'name' ? `new-${kind}` : (kind === 'channel' ? channel.id : role.id) } });
    await dispatch(f, submit); const preview = submit.calls.find(([kind]) => kind === 'edit')[1];
    assert.equal(submit.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.equal(kind === 'channel' ? channel.name : role.name, kind === 'channel' ? 'old-name' : 'safe-name');
    const confirm = routed(f, `voidtide:manage:confirm:${tokenFor(preview)}`); await dispatch(f, confirm);
    assert.equal(kind === 'channel' ? channel.name : role.name, `new-${kind}`);
  }
  assert.equal(f.calls.some(([kind]) => ['overwrite', 'deleteChannel', 'addRole'].includes(kind)), false);
  const denied = routed(f, 'voidtide:manage:role-form', { actor: f.ordinary }); await dispatch(f, denied);
  assert.equal(denied.calls[0][0], 'reply'); assert.equal(denied.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('member select and clear interactions use private responses and cannot invoke admin controls', async (t) => {
  const f = await fixture(t); await profileSetup(f); const request = selection(f, 'country');
  const choose = routed(f, 'voidtide:profile:country:v1', { actor: f.ordinary, type: 'select', values: ['ma'], channelId: request.channelId, message: request.message });
  await dispatch(f, choose); assert.equal(choose.calls[0][1].flags, MessageFlags.Ephemeral); assert.match(choose.calls[1][1].content, /updated/);
  const clear = routed(f, 'voidtide:profile:clear-country:v1', { actor: f.ordinary, channelId: request.channelId, message: request.message });
  await dispatch(f, clear); assert.match(clear.calls[1][1].content, /removed/);
  const denied = routed(f, 'voidtide:manage:setup', { actor: f.ordinary }); await dispatch(f, denied);
  assert.match(denied.calls[0][1].content, /permission/);
  const wrongGuild = routed(f, 'voidtide:manage:setup', { guildId: 'another-server' }); await dispatch(f, wrongGuild);
  assert.match(wrongGuild.calls[0][1].content, /different server/);
});

test('country disable is confirmed, preserves existing flags and allows members to clear them', async (t) => {
  const f = await fixture(t); await profileSetup(f); const request = selection(f, 'country');
  await f.management.profiles.select(request, 'country', ['ma']);
  const reply = await f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'country', enabled: false });
  await f.management.profileAdmin.confirm(f.interaction('manage-server'), tokenFor(reply));
  const config = configFor(f.store, f.guild.id); assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ma']), true);
  await assert.rejects(f.management.profiles.select(request, 'country', ['fr']), /disabled/);
  await f.management.profiles.select(request, 'country', []);
  assert.equal(f.ordinary.roles.cache.has(config.profile.roles['country:ma']), false);
});

test('wrong-type, private, duplicate or privileged existing resources fail preview without mutation', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('🎭・choose-your-roles', { type: ChannelType.GuildVoice });
  await assert.rejects(f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' }), /wrong type/); assert.deepEqual(f.calls, []);
  channel.type = ChannelType.GuildText; await channel.permissionOverwrites.edit(f.guild.id, { ViewChannel: false }); const start = f.calls.length;
  await assert.rejects(f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' }), /must be public/);
  assert.equal(f.calls.length, start);
  await channel.permissionOverwrites.edit(f.guild.id, { ViewChannel: true }); f.role('TikTok', [P.ManageRoles]);
  await assert.rejects(f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' }), /privileges/);
});

test('panel message deletion is repaired once and a lost send response recovers the same message', async (t) => {
  const f = await fixture(t); await profileSetup(f);
  const saved = f.store.get(f.guild.id, 'deliveries', PANEL_KEYS.social); const channel = f.guild.channels.cache.get(saved.channelId);
  channel.messages.cache.delete(saved.messageId);
  const send = channel.send.bind(channel); let fail = true;
  channel.send = async (payload) => { const message = await send(payload); if (fail) { fail = false; throw new Error('lost API response'); } return message; };
  await assert.rejects(f.management.profiles.publish(f.guild), /lost API/);
  assert.equal(channel.messages.cache.size, 1);
  await f.management.profiles.publish(f.guild); assert.equal(channel.messages.cache.size, 1);
  assert.notEqual(f.store.get(f.guild.id, 'deliveries', PANEL_KEYS.social).messageId, saved.messageId);
});

test('official notification adapters mention exactly the corresponding opt-in role and deduplicate/cool down across instances', async (t) => {
  const f = await fixture(t); await profileSetup(f); f.botRole.permissions.add(P.MentionEveryone);
  const config = configFor(f.store, f.guild.id); let now = Date.now();
  const notifications = new SocialNotifications({ store: f.store, profiles: f.management.profiles, clock: () => now });
  const item = { title: 'Live @everyone', description: 'Video @here <@123456789012345678>' };
  await notifications.deliver(f.guild, 'twitch', 'stream:test:1', item);
  const live = f.guild.channels.cache.get(config.channels['live-now']); const first = [...live.messages.cache.values()][0];
  assert.equal(first.content, `<@&${config.profile.roles['social:twitch']}>`);
  assert.deepEqual(first.allowedMentions, { parse: [], roles: [config.profile.roles['social:twitch']], users: [], repliedUser: false });
  const restarted = new SocialNotifications({ store: f.store, profiles: f.management.profiles, clock: () => now });
  await restarted.deliver(f.guild, 'twitch', 'stream:test:1', item); assert.equal(live.messages.cache.size, 1);
  await assert.rejects(restarted.deliver(f.guild, 'twitch', 'stream:test:2', item), /cooldown/);
  await restarted.deliver(f.guild, 'youtube', 'stream:yt:1', item);
  const youtube = f.guild.channels.cache.get(config.channels['social-youtube']);
  assert.equal([...youtube.messages.cache.values()][0].content, `<@&${config.profile.roles['social:youtube']}>`);
  now += 300_001; await restarted.deliver(f.guild, 'twitch', 'stream:test:2', item); assert.equal(live.messages.cache.size, 2);
  await assert.rejects(restarted.deliver(f.guild, 'tiktok', 'stream:tt:1', item), /unavailable/);
});

test('notification settings modal requires review; missing ping permissions and disabled platforms send nothing', async (t) => {
  const f = await fixture(t); await profileSetup(f); const config = configFor(f.store, f.guild.id);
  const item = { title: 'New stream', description: 'Watch now' };
  await assert.rejects(f.management.notifications.deliver(f.guild, 'twitch', 'test:missing', item), /Mention Everyone/);
  const destination = f.guild.channels.cache.get(config.channels['live-now']); assert.equal(destination.messages.cache.size, 0);
  const open = routed(f, 'voidtide:manage:platform', { type: 'select', values: ['twitch'] }); await dispatch(f, open);
  assert.equal(open.calls[0][0], 'modal');
  const submit = routed(f, 'voidtide:manage:notification-submit:twitch', { type: 'modal', fields: { getTextInputValue: (key) => ({ enabled: 'false', channel: destination.id, cooldown: '10' })[key] } });
  await dispatch(f, submit); const preview = submit.calls.find(([kind]) => kind === 'edit')[1];
  assert.equal(f.store.get(f.guild.id, 'social-settings', 'twitch'), null);
  await dispatch(f, routed(f, `voidtide:manage:confirm:${tokenFor(preview)}`));
  assert.deepEqual(f.store.get(f.guild.id, 'social-settings', 'twitch'), { enabled: false, channelId: destination.id, cooldownMinutes: 10 });
  await assert.rejects(f.management.notifications.deliver(f.guild, 'twitch', 'test:disabled', item), /disabled/);
  assert.equal(destination.messages.cache.size, 0);
});

test('YouTube catch-up honors opt-in roles/cooldown without losing checkpoint or pinging an upload twice', async (t) => {
  const f = await fixture(t); await profileSetup(f); f.botRole.permissions.add(P.MentionEveryone);
  const config = configFor(f.store, f.guild.id); const account = `UC${'a'.repeat(22)}`; const key = `youtube:${account}`; let now = Date.now();
  f.store.set(f.guild.id, 'streams', key, { provider: 'youtube', account, channelId: config.channels['social-youtube'], playlist: 'uploads', initialized: true, lastId: 'ccccccccccc' });
  const notifications = new SocialNotifications({ store: f.store, profiles: f.management.profiles, clock: () => now });
  const service = new StreamService({ store: f.store, logger: { error() {} }, environment: { YOUTUBE_API_KEY: 'test-key' }, notifications, clock: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((id) => ({ snippet: { channelTitle: 'VOIDTIDE', title: id, resourceId: { videoId: id } } })) }) }),
  });
  await service.tick(f.guild); const channel = f.guild.channels.cache.get(config.channels['social-youtube']);
  assert.equal(channel.messages.cache.size, 1); assert.equal(f.store.get(f.guild.id, 'streams', key).lastId, 'ccccccccccc');
  now += 300_001; await service.tick(f.guild);
  assert.equal(channel.messages.cache.size, 2); assert.equal(f.store.get(f.guild.id, 'streams', key).lastId, 'aaaaaaaaaaa');
  now += 300_001; await service.tick(f.guild); assert.equal(channel.messages.cache.size, 2);
  for (const message of channel.messages.cache.values()) assert.deepEqual(message.allowedMentions.roles, [config.profile.roles['social:youtube']]);
});

test('unsafe administrative role edits, duplicate channel names and invalid notification settings are rejected', async (t) => {
  const f = await fixture(t); await profileSetup(f); const admin = f.management.profileAdmin;
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'create-role', name: 'Administrator' }), /nonprivileged/);
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'rename-role', id: f.owner.roles.highest.id, name: 'Gamer 2' }), /privileges|below/);
  f.addChannel('already-there');
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'create-channel', name: 'already-there' }), /already exists/);
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'create-channel', name: 'welcome' }), /welcome/);
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'notification', platform: 'x', settings: { enabled: true, channelId: 'bad', cooldownMinutes: 0 } }), /platform/);
  assert.equal(PANEL_CHANNELS.social, 'notification-roles');
});

test('notification-setting changes invalidate previous reviews and revoked administrators cannot confirm', async (t) => {
  const f = await fixture(t); await profileSetup(f); const admin = f.management.profileAdmin;
  const first = await admin.review(f.interaction('manage-server'), { type: 'refresh' });
  f.store.set(f.guild.id, 'social-settings', 'twitch', { enabled: false, channelId: configFor(f.store, f.guild.id).channels['live-now'], cooldownMinutes: 30 });
  await assert.rejects(admin.confirm(f.interaction('manage-server'), tokenFor(first)), /changed/);
  const second = await admin.review(f.interaction('manage-server'), { type: 'refresh' });
  const staleInteraction = f.interaction('manage-server'); f.owner.roles.cache.delete(f.owner.roles.highest.id);
  await assert.rejects(admin.confirm(staleInteraction, tokenFor(second)), /current server administrators/);
});

test('emoji/plain role aliases are reused and ambiguous aliases stop setup', async (t) => {
  const f = await fixture(t); const tiktok = f.role('🎵 TikTok'); const morocco = f.role('Morocco');
  await profileSetup(f); const config = configFor(f.store, f.guild.id);
  assert.equal(config.profile.roles['social:tiktok'], tiktok.id); assert.equal(config.profile.roles['country:ma'], morocco.id);
  f.role('TikTok');
  await assert.rejects(f.management.profileAdmin.review(f.interaction('manage-server'), { type: 'setup' }), /duplicate/);
});

test('manual resource creation is confirmed, normalized and nonprivileged with explicit new-channel overwrites', async (t) => {
  const f = await fixture(t); const admin = f.management.profileAdmin;
  let preview = await admin.review(f.interaction('manage-server'), { type: 'create-channel', name: 'Game Notes' });
  assert.deepEqual(f.calls, []); assert.equal(JSON.parse(preview.files[0].attachment).name, 'game-notes');
  await admin.confirm(f.interaction('manage-server'), tokenFor(preview));
  const channel = [...f.guild.channels.cache.values()].find((c) => c.name === 'game-notes');
  assert.ok(channel); assert.equal(channel.permissionsFor(f.guild.roles.everyone).has(P.SendMessages), false);
  await assert.rejects(admin.review(f.interaction('manage-server'), { type: 'create-channel', name: 'Game Notes' }), /already exists/);
  preview = await admin.review(f.interaction('manage-server'), { type: 'create-role', name: 'Casual Player' });
  await admin.confirm(f.interaction('manage-server'), tokenFor(preview));
  const role = [...f.guild.roles.cache.values()].find((r) => r.name === 'Casual Player');
  assert.equal(role.permissions.bitfield, 0n); assert.equal(f.calls.some(([kind]) => kind === 'addRole'), false);
});

test('lost notification responses recover without duplicate pings and an already-sent item tolerates destination changes', async (t) => {
  const f = await fixture(t); await profileSetup(f); f.botRole.permissions.add(P.MentionEveryone);
  const channel = f.guild.channels.cache.get(configFor(f.store, f.guild.id).channels['live-now']);
  const send = channel.send.bind(channel); let loseResponse = true;
  channel.send = async (payload) => { const message = await send(payload); if (loseResponse) { loseResponse = false; throw new Error('lost send response'); } return message; };
  const item = { title: 'Live now', description: 'Watch the stream' };
  await assert.rejects(f.management.notifications.deliver(f.guild, 'twitch', 'stream:lost:1', item), /lost send/);
  assert.equal(channel.messages.cache.size, 1);
  await f.management.notifications.deliver(f.guild, 'twitch', 'stream:lost:1', item);
  assert.equal(channel.messages.cache.size, 1);
  f.store.set(f.guild.id, 'social-settings', 'twitch', { enabled: true, channelId: configFor(f.store, f.guild.id).channels['social-updates'], cooldownMinutes: 5 });
  await f.management.notifications.deliver(f.guild, 'twitch', 'stream:lost:1', item);
  assert.equal(channel.messages.cache.size, 1);
});
