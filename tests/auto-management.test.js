import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { autoRule } from '../src/commands/auto-rule.js';
import { configFor, embed, sendOnce } from '../src/services/management-utils.js';
import { LAYOUT, SELF_ROLES } from '../src/config/server-layout.js';
import { fixture } from './helpers/community-fixture.js';

const preview = (f, options = {}, actor = f.owner) => f.management.execute(f.interaction('auto-fix', options, actor));
async function repair(f) { await preview(f); return preview(f, { confirm: true }); }

test('setup commands expose confirmation without deletion or privileged account-assignment options', () => {
  for (const name of ['setup-server', 'setup-channels', 'setup-roles', 'auto-fix']) {
    const data = getCommandDefinitions().find((c) => c.name === name);
    assert.equal(data.default_member_permissions, P.Administrator.toString());
    assert.deepEqual(data.options.map((o) => o.name), ['confirm']);
  }
});

test('setup alias previews no mutations and rejects old destructive or privileged options', async (t) => {
  const f = await fixture(t); const reply = await preview(f); const plan = JSON.parse(reply.files[0].attachment);
  assert.equal(plan.automaticDeletion, false); assert.equal(plan.existingPermissionsChanged, false);
  assert.equal(plan.privilegedRolesAssigned, false); assert.deepEqual(f.calls, []);
  assert.equal(f.store.get(f.guild.id, 'config', 'server'), null);
  await assert.rejects(preview(f, { delete_conflicts: true }), /deletion was removed/);
  await assert.rejects(preview(f, { badr: f.ordinary.user }), /assignments were removed/);
  await assert.rejects(preview(f, {}, f.ordinary), /permission/);
});

test('confirmation is bound to command, administrator, settings and expiry', async (t) => {
  const f = await fixture(t); await assert.rejects(preview(f, { confirm: true }), /fresh setup preview/);
  await preview(f);
  await assert.rejects(f.management.execute(f.interaction('setup-server', { confirm: true })), /fresh setup preview/);
  const other = f.member(undefined, [f.role('Administrator', [P.Administrator])]);
  await assert.rejects(preview(f, { confirm: true }, other), /fresh setup preview/);
  await preview(f); f.management.setup.previews.get(`${f.guild.id}:${f.owner.id}:auto-fix`).expires = 0;
  await assert.rejects(preview(f, { confirm: true }), /fresh setup preview/);
  await preview(f); f.store.set(f.guild.id, 'config', 'server', { xpEnabled: false });
  await assert.rejects(preview(f, { confirm: true }), /fresh setup preview/);
  assert.deepEqual(f.calls, []);
});

test('simple setup creates the exact requested layout and zero-permission roles without welcome channels', async (t) => {
  const f = await fixture(t); await repair(f);
  assert.deepEqual([...f.guild.channels.cache.values()].map((c) => c.name), LAYOUT.flatMap(([category, names]) => [category, ...names]));
  assert.equal(f.guild.channels.cache.size, 22);
  assert.ok(f.calls.filter(([kind]) => kind === 'role').every(([, options]) => options.permissions.length === 0));
  assert.equal(f.calls.some(([kind]) => ['addRole', 'overwrite', 'deleteChannel'].includes(kind)), false);
  const config = configFor(f.store, f.guild.id);
  assert.equal(config.welcomeEnabled, false); assert.equal(config.channels.welcome, undefined);
  assert.equal(f.guild.channels.cache.get(config.categories.VOICE).type, ChannelType.GuildCategory);
  assert.equal([...f.guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildVoice).length, 3);
});

test('legacy channels are renamed and organized while all existing overwrites and messages are preserved', async (t) => {
  const f = await fixture(t); const category = f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  const game = f.addChannel('gaming-chat', { parent: category.id });
  const unrelated = f.addChannel('old-welcome'); const message = await game.send({ content: 'Keep our history' });
  await game.permissionOverwrites.edit(f.guild.id, { AttachFiles: false }); f.calls.length = 0;
  const before = [...game.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield]);
  await repair(f); const config = configFor(f.store, f.guild.id);
  assert.equal(config.channels['gaming-chat'], game.id); assert.equal(game.name, '💬・gaming-chat');
  assert.equal(category.name, "🎮 LET'S PLAY");
  assert.deepEqual([...game.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield]), before);
  assert.equal(game.messages.cache.get(message.id).content, 'Keep our history');
  assert.equal(f.guild.channels.cache.get(unrelated.id).name, 'old-welcome');
  assert.equal(f.calls.some(([kind]) => ['overwrite', 'deleteChannel'].includes(kind)), false);
  const count = f.guild.channels.cache.size; await repair(f); assert.equal(f.guild.channels.cache.size, count);
});

test('public staff resources stop setup for manual review rather than changing permissions', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('staff-chat');
  await assert.rejects(preview(f), /make it private manually/);
  assert.equal(channel.permissionsFor(f.ordinary).has(P.ViewChannel), true); assert.deepEqual(f.calls, []);
});

test('five public buttons toggle safe roles for unverified members and never grant privileged roles', async (t) => {
  const f = await fixture(t); await repair(f); const config = configFor(f.store, f.guild.id);
  const panel = f.store.get(f.guild.id, 'deliveries', 'panel:roles:v2');
  const channel = f.guild.channels.cache.get(panel.channelId); const message = channel.messages.cache.get(panel.messageId);
  assert.equal(channel.permissionsFor(f.ordinary).has([P.ViewChannel, P.ReadMessageHistory]), true);
  assert.deepEqual(message.components[0].components.map((b) => b.label), SELF_ROLES.map((r) => r.name));
  const request = f.interaction('role-panel', { channelId: channel.id, message }, f.ordinary);
  assert.equal(f.ordinary.roles.cache.has(config.roles.Verified), false);
  for (const choice of SELF_ROLES) {
    await f.management.community.toggleRole(request, choice.key); assert.equal(f.ordinary.roles.cache.has(config.roles[choice.name]), true);
    await f.management.community.toggleRole(request, choice.key); assert.equal(f.ordinary.roles.cache.has(config.roles[choice.name]), false);
  }
  await assert.rejects(f.management.community.toggleRole(request, 'Moderator'), /not self-assignable/);
  await assert.rejects(f.management.community.toggleRole({ ...request, message: { id: 'copied' } }, 'gamer'), /current role panel/);
  const role = f.guild.roles.cache.get(config.roles.Gamer); role.permissions.add(P.ManageRoles);
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /privileges/);
});

test('role selection checks screening, bot hierarchy and channel grants before assigning', async (t) => {
  const f = await fixture(t); await repair(f); const config = configFor(f.store, f.guild.id);
  const panel = f.store.get(f.guild.id, 'deliveries', 'panel:roles:v2');
  const request = f.interaction('role-panel', { channelId: panel.channelId, message: { id: panel.messageId } }, f.ordinary);
  f.ordinary.pending = true;
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /screening/); f.ordinary.pending = false;
  const role = f.guild.roles.cache.get(config.roles.Gamer); role.position = 101;
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /below the bot/); role.position = 1;
  await f.guild.channels.cache.get(config.channels['staff-chat']).permissionOverwrites.edit(role.id, { ViewChannel: true });
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /channel permission grants/);
  assert.equal(f.ordinary.roles.cache.has(role.id), false);
});

test('private legacy role channels are kept untouched while one new public panel is created', async (t) => {
  const f = await fixture(t); const old = f.addChannel('choose-roles', { permissionOverwrites: [{ id: f.guild.id, deny: [P.ViewChannel] }, { id: f.bot.id, allow: [P.ViewChannel] }] });
  f.store.set(f.guild.id, 'config', 'server', { channels: { 'choose-roles': old.id } });
  await repair(f); const config = configFor(f.store, f.guild.id);
  assert.notEqual(config.channels['choose-roles'], old.id); assert.equal(old.name, 'choose-roles');
  assert.equal(old.permissionsFor(f.ordinary).has(P.ViewChannel), false);
  const count = f.guild.channels.cache.size; await repair(f); assert.equal(f.guild.channels.cache.size, count);
});

test('existing native staff roles can view staff channels; no privileged role is created or assigned', async (t) => {
  const f = await fixture(t); const role = f.role('Community Helpers', [P.ModerateMembers]); const staff = f.member(undefined, [role]);
  await repair(f); const config = configFor(f.store, f.guild.id); const channel = f.guild.channels.cache.get(config.channels['staff-chat']);
  assert.equal(channel.permissionsFor(staff).has(P.ViewChannel), true);
  assert.equal(channel.permissionsFor(f.ordinary).has(P.ViewChannel), false);
  assert.equal(f.calls.some(([kind]) => kind === 'addRole'), false);
});

test('old destructive setup options cannot delete conflicting channels', async (t) => {
  const f = await fixture(t); const wrong = f.addChannel('gaming-chat', { type: ChannelType.GuildVoice });
  await assert.rejects(preview(f), /expected GuildText/);
  await assert.rejects(preview(f, { delete_conflicts: true }), /deletion was removed/);
  assert.equal(f.guild.channels.cache.has(wrong.id), true); assert.deepEqual(f.calls, []);
});

test('partial setup recovers saved IDs after API errors without duplicating resources', async (t) => {
  const f = await fixture(t); const create = f.guild.channels.create; let count = 0;
  f.store.set(f.guild.id, 'config', 'server', { complete: true });
  f.guild.channels.create = async (...args) => { if (++count === 4) throw new Error('simulated Discord failure'); return create(...args); };
  await preview(f); await assert.rejects(preview(f, { confirm: true }), /simulated/);
  assert.equal(configFor(f.store, f.guild.id).complete, false, 'a failed upgrade is not reported as complete');
  f.guild.channels.create = create; await repair(f);
  const names = [...f.guild.channels.cache.values()].map((c) => `${c.type}:${c.name}`);
  assert.equal(new Set(names).size, names.length);
});

test('auto-rule refresh after setup preserves permissions and offers Agree only', async (t) => {
  const f = await fixture(t); await repair(f); f.calls.length = 0;
  const request = (confirm) => { const value = f.interaction('auto-rule', { confirm }); value.deferReply = async () => {}; value.editReply = async () => {}; return value; };
  const services = { rulesService: f.rulesService, management: f.management };
  await autoRule.execute(request(false), services); await autoRule.execute(request(true), services);
  const state = await f.rulesService.store.get(f.guild.id);
  const channel = f.guild.channels.cache.get(state.rulesChannelId); const message = channel.messages.cache.get(state.rulesMessageId);
  assert.equal(message.components[0].components.length, 1); assert.equal(message.components[0].components[0].label, 'I Agree');
  assert.equal(f.calls.some(([kind]) => kind === 'overwrite'), false);
});

test('migration preserves legacy rules gates, panel history, service destinations and persistent records', async (t) => {
  const f = await fixture(t); const verified = f.role('Verified'); const moderator = f.role('Moderator', [P.ModerateMembers]);
  const gameCategory = f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  const info = f.addChannel('START HERE', { type: ChannelType.GuildCategory });
  const support = f.addChannel('SUPPORT', { type: ChannelType.GuildCategory });
  const privateOptions = { permissionOverwrites: [{ id: f.guild.id, deny: [P.ViewChannel] }, { id: verified.id, deny: [P.ViewChannel] },
    { id: f.bot.id, allow: [P.ViewChannel] }, { id: moderator.id, allow: [P.ViewChannel] }] };
  const staff = f.addChannel('STAFF', { ...privateOptions, type: ChannelType.GuildCategory });
  const staffChat = f.addChannel('staff-chat', { ...privateOptions, parent: staff.id });
  const logs = f.addChannel('mod-logs', { ...privateOptions, parent: staff.id });
  const game = f.addChannel('gaming-chat', { parent: gameCategory.id });
  const announcements = f.addChannel('announcements', { parent: info.id });
  const roles = f.addChannel('choose-roles', { parent: info.id });
  const tickets = f.addChannel('open-ticket', { parent: support.id });
  const welcome = f.addChannel('welcome');
  await sendOnce(f.store, roles, 'panel:roles', { embeds: [embed('Old role panel', 'Legacy choices')], components: [] });
  await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' }); await f.rulesService.setup(f.guild, f.owner.id);
  const rules = await f.rulesService.store.get(f.guild.id);
  const legacy = { roles: { Verified: verified.id, Moderator: moderator.id }, categories: { GAMING: gameCategory.id, 'START HERE': info.id, SUPPORT: support.id, STAFF: staff.id },
    channels: { 'gaming-chat': game.id, general: game.id, announcements: announcements.id, 'choose-roles': roles.id, 'open-ticket': tickets.id, 'mod-logs': logs.id, 'ticket-logs': logs.id, 'staff-chat': staffChat.id, '📜・rules': rules.rulesChannelId, welcome: welcome.id },
    welcomeEnabled: true, xpEnabled: true, antiSpamEnabled: false };
  f.store.set(f.guild.id, 'config', 'server', legacy);
  for (const namespace of ['xp', 'tickets', 'cases', 'jobs', 'streams']) f.store.set(f.guild.id, namespace, 'preserved', { marker: namespace, channelId: announcements.id });
  const ids = [...f.guild.channels.cache.keys()];
  const snapshot = () => ids.map((id) => [id, [...f.guild.channels.cache.get(id).permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield])]);
  const before = snapshot(); f.calls.length = 0;
  await repair(f);
  assert.deepEqual(snapshot(), before);
  assert.equal(f.calls.some(([kind]) => ['overwrite', 'deleteChannel', 'addRole'].includes(kind)), false);
  const config = configFor(f.store, f.guild.id);
  assert.equal(config.channels.announcements, announcements.id); assert.equal(config.channels['mod-logs'], logs.id);
  assert.equal(config.channels['gaming-chat'], game.id); assert.equal(config.roles.Verified, verified.id);
  assert.equal(welcome.name, 'welcome'); assert.equal(config.welcomeEnabled, false); assert.equal(config.antiSpamEnabled, false);
  const updatedRules = await f.rulesService.store.get(f.guild.id);
  assert.deepEqual(updatedRules.gatedChannelIds, rules.gatedChannelIds); assert.equal(updatedRules.rulesMessageId, rules.rulesMessageId);
  assert.notEqual(config.channels['choose-roles'], roles.id);
  const oldPanel = f.store.get(f.guild.id, 'deliveries', 'panel:roles');
  assert.deepEqual(roles.messages.cache.get(oldPanel.messageId).components, []);
  for (const namespace of ['xp', 'tickets', 'cases', 'jobs', 'streams']) assert.deepEqual(f.store.get(f.guild.id, namespace, 'preserved'), { marker: namespace, channelId: announcements.id });
});

test('role toggles serialize repeated clicks and report lost Manage Roles safely', async (t) => {
  const f = await fixture(t); await repair(f); const config = configFor(f.store, f.guild.id);
  const panel = f.store.get(f.guild.id, 'deliveries', 'panel:roles:v2');
  const request = f.interaction('role-panel', { channelId: panel.channelId, message: { id: panel.messageId } }, f.ordinary);
  await Promise.all([f.management.community.toggleRole(request, 'gamer'), f.management.community.toggleRole(request, 'gamer')]);
  assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), false);
  f.botRole.permissions.remove(P.ManageRoles);
  await assert.rejects(f.management.community.toggleRole(request, 'gamer'), /needs Manage Roles/);
  assert.equal(f.ordinary.roles.cache.has(config.roles.Gamer), false);
});

test('existing announcement-channel type is reused without converting it or editing overwrites', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('announcements', { type: ChannelType.GuildAnnouncement });
  await repair(f); const config = configFor(f.store, f.guild.id);
  assert.equal(config.channels.announcements, channel.id);
  assert.equal(channel.name, '📢・announcements'); assert.equal(channel.type, ChannelType.GuildAnnouncement);
  assert.equal(f.calls.some(([kind]) => kind === 'overwrite'), false);
  await f.management.execute(f.interaction('announce', { title: 'Gaming tonight', description: 'Join us for games.' }));
  assert.equal(channel.messages.cache.size, 1);
});

test('existing staff roles can handle tickets after category reorganization without new privileged roles', async (t) => {
  const f = await fixture(t); const role = f.role('Helpers', [P.ModerateMembers]); const helper = f.member(undefined, [role]);
  await repair(f); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified);
  await f.management.execute(f.interaction('ticket', { category: 'General Help' }, f.ordinary));
  const ticket = f.store.list(f.guild.id, 'tickets')[0]; const channel = f.guild.channels.cache.get(ticket.value.channelId);
  assert.equal(channel.permissionsFor(helper).has(P.ViewChannel), true);
  const newParent = f.addChannel('Manual category move', { type: ChannelType.GuildCategory });
  await channel.setParent(newParent.id, { lockPermissions: false });
  await f.management.execute(f.interaction('ticket', { category: 'General Help' }, f.ordinary));
  assert.equal(f.store.list(f.guild.id, 'tickets').length, 1);
  await f.management.execute(f.interaction('close-ticket', { channelId: channel.id }, helper));
  assert.equal(f.store.get(f.guild.id, 'tickets', ticket.key).status, 'closed');
});
