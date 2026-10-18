import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { autoRule } from '../src/commands/auto-rule.js';
import { configFor } from '../src/services/management-utils.js';
import { RULES_TEXT } from '../src/config/rules-text.js';
import { RULES_AGREE_BUTTON_ID, RULES_MAIN_TEXT, RULES_AGREEMENT_TEXT } from '../src/services/rules-payload.js';
import { fixture } from './helpers/community-fixture.js';

function rulesRequest(f, confirm = false, actor = f.owner) {
  const request = f.interaction('auto-rule', { confirm }, actor);
  request.responses = [];
  request.deferReply = async (payload) => { request.responses.push(['defer', payload]); };
  request.editReply = async (payload) => { request.responses.push(['edit', payload]); };
  return request;
}
const preview = (f, options = {}, actor = f.owner) => f.management.execute(f.interaction('auto-fix', options, actor));
async function repair(f, options = {}) { await preview(f, options); return preview(f, { ...options, confirm: true }); }

test('auto commands serialize with Administrator permissions and explicit confirmation', () => {
  for (const name of ['auto-fix', 'auto-rule']) {
    const data = getCommandDefinitions().find((c) => c.name === name);
    assert.equal(data.default_member_permissions, P.Administrator.toString());
    assert.equal(data.options[0].name, 'confirm'); assert.ok(!data.options[0].required);
  }
});

test('auto-fix preview never mutates Discord or persistent configuration', async (t) => {
  const f = await fixture(t); f.addChannel('general', { type: ChannelType.GuildVoice });
  const reply = await preview(f); const plan = JSON.parse(reply.files[0].attachment);
  assert.ok(plan.actions.some((a) => a.action === 'archive'));
  assert.ok(plan.actions.some((a) => a.action === 'create' && a.name === 'general'));
  assert.match(reply.content, /Permanently DELETE: 0/); assert.deepEqual(f.calls, []);
  assert.equal(f.store.get(f.guild.id, 'config', 'server'), null);
  assert.equal(await f.rulesService.store.get(f.guild.id), null);
  assert.deepEqual(f.store.list(f.guild.id, 'repairs'), []);
});

test('auto-fix enforces actor, expiry, options and fingerprint before mutations', async (t) => {
  const f = await fixture(t);
  await assert.rejects(preview(f, {}, f.ordinary), /permission/);
  await assert.rejects(preview(f, { confirm: true }), /without confirm first/);
  await preview(f);
  await assert.rejects(preview(f, { confirm: true, delete_conflicts: true }), /same delete_conflicts/);
  const admin = f.member(undefined, [f.role('administrator', [P.Administrator])]);
  await assert.rejects(preview(f, { confirm: true }, admin), /same.*administrator/);
  await preview(f); f.management.autoFix.reviews.get(`${f.guild.id}:${f.owner.id}`).expires = 0;
  await assert.rejects(preview(f, { confirm: true }), /within 10 minutes/);
  await preview(f); f.addChannel('changed-after-preview');
  await assert.rejects(preview(f, { confirm: true }), /fresh preview/); assert.deepEqual(f.calls, []);
});

test('auto-fix creates categories, archives incompatible channels and preserves conversations', async (t) => {
  const f = await fixture(t); const gaming = f.addChannel('gaming');
  const wrong = f.addChannel('general', { type: ChannelType.GuildVoice }); const unrelated = f.addChannel('our-history');
  const message = await unrelated.send({ content: 'Keep this conversation' });
  await repair(f); const config = configFor(f.store, f.guild.id);
  assert.equal(gaming.name, 'gaming');
  assert.equal(f.guild.channels.cache.get(config.categories.GAMING).type, ChannelType.GuildCategory);
  assert.match(wrong.name, /general-archived-/);
  assert.equal(f.guild.channels.cache.get(config.channels.general).type, ChannelType.GuildText);
  assert.equal(unrelated.messages.cache.get(message.id).content, 'Keep this conversation'); assert.equal(unrelated.parentId, null);
  assert.equal(f.calls.some(([kind]) => kind === 'deleteChannel'), false);
  const counts = [f.guild.channels.cache.size, f.guild.roles.cache.size]; await repair(f);
  assert.deepEqual([f.guild.channels.cache.size, f.guild.roles.cache.size], counts);
  assert.equal(f.store.list(f.guild.id, 'repairs').at(-1).value.status, 'completed');
});

test('auto-fix corrects saved names and category placement while preserving channel overwrites', async (t) => {
  const f = await fixture(t); await f.setup(); const config = configFor(f.store, f.guild.id);
  const channel = f.guild.channels.cache.get(config.channels.general); channel.name = 'renamed-lounge'; channel.parentId = null;
  const before = [...channel.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield]);
  await repair(f); assert.equal(channel.name, 'general'); assert.equal(channel.parentId, config.categories.COMMUNITY);
  assert.deepEqual([...channel.permissionOverwrites.cache.values()].map((o) => [o.id, o.allow.bitfield, o.deny.bitfield]), before);
});

test('permanent deletion requires matching delete_conflicts preview and preserves unrelated channels', async (t) => {
  const f = await fixture(t); const canonical = f.addChannel('general'); const duplicate = f.addChannel('general'); const unrelated = f.addChannel('keep-me');
  await duplicate.send({ content: 'Explicit deletion removes this history' });
  const reply = await preview(f, { delete_conflicts: true }); const plan = JSON.parse(reply.files[0].attachment);
  assert.equal(plan.actions.filter((a) => a.action === 'delete').length, 1);
  assert.equal(plan.actions.find((a) => a.action === 'delete').id, duplicate.id);
  assert.match(reply.content, /Deleted channels lose all history and threads/); assert.equal(f.guild.channels.cache.has(duplicate.id), true);
  await preview(f, { confirm: true, delete_conflicts: true });
  assert.equal(f.guild.channels.cache.has(duplicate.id), false); assert.equal(f.guild.channels.cache.has(unrelated.id), true);
  assert.equal(configFor(f.store, f.guild.id).channels.general, canonical.id);
});

test('referenced conflicts and categories with children are archived even with deletion enabled', async (t) => {
  const f = await fixture(t); f.addChannel('general'); const referenced = f.addChannel('general');
  f.store.set(f.guild.id, 'jobs', 'future', { channelId: referenced.id });
  f.addChannel('GAMING', { type: ChannelType.GuildCategory }); const duplicate = f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  const child = f.addChannel('custom-game', { parent: duplicate.id }); await repair(f, { delete_conflicts: true });
  assert.match(referenced.name, /archived-/); assert.match(duplicate.name, /archived-/); assert.equal(child.parentId, duplicate.id);
  assert.equal(f.calls.some(([kind]) => kind === 'deleteChannel'), false);
});

test('auto-fix repairs staff visibility without giving Verified access to staff channels', async (t) => {
  const f = await fixture(t); const staff = f.addChannel('staff-chat'); const extraRole = f.role('unrelated-role');
  await staff.permissionOverwrites.edit(extraRole.id, { ViewChannel: true });
  const reply = await preview(f); const plan = JSON.parse(reply.files[0].attachment);
  assert.ok(plan.staffResources.find((c) => c.id === staff.id).removeViewAllows.includes(extraRole.id));
  await preview(f, { confirm: true }); const config = configFor(f.store, f.guild.id);
  await f.ordinary.roles.add(config.roles.Verified); assert.equal(staff.permissionsFor(f.ordinary).has(P.ViewChannel), false);
  assert.equal(staff.permissionOverwrites.cache.get(extraRole.id).allow.has(P.ViewChannel, false), false);
  const moderator = f.member(undefined, [f.guild.roles.cache.get(config.roles.Moderator)]);
  assert.equal(staff.permissionsFor(moderator).has(P.ViewChannel), true);
});

test('missing channel permissions stop all repairs before mutation', async (t) => {
  const f = await fixture(t); const channel = f.addChannel('general');
  await channel.permissionOverwrites.edit(f.bot.id, { ManageChannels: false }); f.calls.length = 0;
  await assert.rejects(preview(f), /before auto-fix/); assert.deepEqual(f.calls, []);
});

test('auto-fix refuses Administrator on everyone before making changes', async (t) => {
  const f = await fixture(t); f.guild.roles.everyone.permissions.add(P.Administrator);
  await assert.rejects(preview(f), /Remove Administrator from @everyone/);
  assert.deepEqual(f.calls, []);
});

test('empty duplicate categories can be explicitly deleted while system channels stay preserved', async (t) => {
  const f = await fixture(t); const chosen = f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  const duplicate = f.addChannel('GAMING', { type: ChannelType.GuildCategory });
  f.addChannel('general'); const system = f.addChannel('general'); f.guild.systemChannelId = system.id;
  await repair(f, { delete_conflicts: true });
  assert.equal(f.guild.channels.cache.has(duplicate.id), false);
  assert.equal(configFor(f.store, f.guild.id).categories.GAMING, chosen.id);
  assert.equal(f.guild.channels.cache.has(system.id), true); assert.match(system.name, /archived-/);
});

test('auto-fix replaces an incompatible saved channel through archive and durable remapping', async (t) => {
  const f = await fixture(t); const wrong = f.addChannel('general', { type: ChannelType.GuildVoice });
  f.store.set(f.guild.id, 'config', 'server', { channels: { general: wrong.id } });
  await repair(f, { delete_conflicts: true });
  const config = configFor(f.store, f.guild.id);
  assert.notEqual(config.channels.general, wrong.id);
  assert.equal(f.guild.channels.cache.get(config.channels.general).type, ChannelType.GuildText);
  assert.match(wrong.name, /archived-/); assert.equal(f.guild.channels.cache.has(wrong.id), true);
});

test('partial auto-fix creation resumes using saved IDs and retains an audit', async (t) => {
  const f = await fixture(t); const create = f.guild.channels.create; let count = 0;
  f.guild.channels.create = async (...args) => { if (++count === 4) throw new Error('simulated failure'); return create(...args); };
  await preview(f); await assert.rejects(preview(f, { confirm: true }), /Auto-fix stopped/);
  assert.equal(f.store.list(f.guild.id, 'repairs').at(-1).value.status, 'needs-review');
  f.guild.channels.create = create; await repair(f);
  const channels = [...f.guild.channels.cache.values()].map((c) => `${c.type}:${c.name}`); assert.equal(new Set(channels).size, channels.length);
});

test('auto-rule publishes exact rules and one working Agree panel after auto-fix', async (t) => {
  const f = await fixture(t); await repair(f); const request = rulesRequest(f);
  await autoRule.execute(request, { rulesService: f.rulesService, management: f.management });
  assert.match(request.responses.at(-1)[1].content, /\/auto-rule confirm:true/);
  let state = await f.rulesService.store.get(f.guild.id); const channel = f.guild.channels.cache.get(state.rulesChannelId);
  assert.equal(channel.messages.cache.size, 0);
  await autoRule.execute(rulesRequest(f, true), { rulesService: f.rulesService, management: f.management });
  state = await f.rulesService.store.get(f.guild.id); const message = channel.messages.cache.get(state.rulesMessageId);
  const body = channel.messages.cache.get(state.rulesSequence.body);
  const plainText = (text) => text.replaceAll('*', '').replace(/\n{2,}/g, '\n');
  const bodyText = plainText(body.embeds[0].description);
  assert.equal(bodyText, RULES_MAIN_TEXT);
  assert.equal(plainText(message.embeds[0].description), RULES_AGREEMENT_TEXT);
  assert.equal(`${bodyText}\n${plainText(message.embeds[0].description)}`, RULES_TEXT);
  assert.equal(message.components[0].components[0].customId, RULES_AGREE_BUTTON_ID);
  assert.equal(channel.permissionsFor(f.ordinary).has(P.ViewChannel), true);
  const config = configFor(f.store, f.guild.id);
  assert.equal(f.guild.channels.cache.get(config.channels.welcome).permissionsFor(f.ordinary).has(P.ViewChannel), true);
  assert.equal(f.guild.channels.cache.get(config.channels.general).permissionsFor(f.ordinary).has(P.ViewChannel), false);
  await f.rulesService.verify({ guild: f.guild, user: f.ordinary.user, channelId: channel.id, message });
  assert.equal(f.ordinary.roles.cache.has(state.verifiedRoleId), true);
  assert.equal(f.guild.channels.cache.get(config.channels.general).permissionsFor(f.ordinary).has(P.ViewChannel), true);
  assert.equal(f.guild.channels.cache.get(config.channels['staff-chat']).permissionsFor(f.ordinary).has(P.ViewChannel), false);
  await autoRule.execute(rulesRequest(f), { rulesService: f.rulesService, management: f.management });
  await autoRule.execute(rulesRequest(f, true), { rulesService: f.rulesService, management: f.management }); assert.equal(channel.messages.cache.size, 3);
});

test('auto-rule rejects ordinary members and also works without community services', async (t) => {
  const f = await fixture(t);
  await assert.rejects(autoRule.execute(rulesRequest(f, false, f.ordinary), { rulesService: f.rulesService }), /administrators/);
  assert.deepEqual(f.calls, []);
  await autoRule.execute(rulesRequest(f), { rulesService: f.rulesService });
  await autoRule.execute(rulesRequest(f, true), { rulesService: f.rulesService });
  assert.ok((await f.rulesService.store.get(f.guild.id)).rulesMessageId);
});
