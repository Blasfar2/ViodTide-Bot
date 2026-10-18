import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { applyPermissionPlan, buildPermissionPlan } from '../src/services/rules-permissions.js';

const { Administrator, ManageChannels, ManageRoles, SendMessages, ViewChannel } = PermissionFlagsBits;
const everyoneId = 'everyone';
const verifiedId = 'verified';
const botId = 'bot';

function overwrite(id, { allow = [], deny = [], type = OverwriteType.Role } = {}) {
  return { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

function fixture() {
  const everyone = { id: everyoneId, permissions: new PermissionsBitField(ViewChannel) };
  const botMember = {
    id: botId,
    permissions: new PermissionsBitField([ViewChannel, ManageChannels, ManageRoles]),
  };
  const guild = {
    id: everyoneId,
    ownerId: 'owner',
    roles: {
      everyone,
      cache: new Map([
        [everyoneId, everyone],
        [verifiedId, { id: verifiedId, permissions: new PermissionsBitField() }],
      ]),
    },
    members: { cache: new Map([[botId, botMember]]) },
    channels: { cache: new Map() },
  };
  const calls = [];

  function addChannel(id, { overwrites = [], type = ChannelType.GuildText, botPermissions } = {}) {
    const cache = new Map(overwrites.map((value) => [value.id, value]));
    const channel = {
      id,
      type,
      permissionOverwrites: {
        cache,
        async edit(target, patch, options) {
          calls.push({ channelId: id, target, patch, options });
          const current = cache.get(target) ?? overwrite(target, { type: options.type });
          const next = overwrite(target, {
            allow: current.allow.bitfield,
            deny: current.deny.bitfield,
            type: options.type,
          });
          for (const [permission, value] of Object.entries(patch)) {
            const flag = PermissionFlagsBits[permission];
            next.allow.remove(flag);
            next.deny.remove(flag);
            (value ? next.allow : next.deny).add(flag);
          }
          cache.set(target, next);
        },
      },
      permissionsFor(subject) {
        if (subject.id === botId && botPermissions) return new PermissionsBitField(botPermissions);
        const permissions = new PermissionsBitField(subject.permissions);
        const inherited = cache.get(everyoneId);
        permissions.remove(inherited?.deny ?? 0n).add(inherited?.allow ?? 0n);
        if (subject.id !== everyoneId) {
          const specific = cache.get(subject.id);
          permissions.remove(specific?.deny ?? 0n).add(specific?.allow ?? 0n);
        }
        return permissions;
      },
    };
    guild.channels.cache.set(id, channel);
    return channel;
  }
  const options = { rulesChannelId: 'rules', verifiedRoleId: verifiedId, botMember };
  return { guild, botMember, calls, addChannel, options };
}

test('permission planning snapshots public channels, excluding rules, threads, and private channels', async () => {
  const { guild, calls, addChannel, options } = fixture();
  addChannel('rules');
  const publicChannel = addChannel('general');
  const category = addChannel('community', { type: ChannelType.GuildCategory });
  addChannel('thread', { type: ChannelType.PublicThread });
  addChannel('staff', { overwrites: [overwrite(everyoneId, { deny: [ViewChannel] })] });
  const plan = await buildPermissionPlan(guild, options);
  assert.deepEqual(plan.targets, [category, publicChannel]);
  assert.deepEqual(plan.skippedPrivate, ['staff']);
  assert.equal(plan.botMemberId, botId);
  assert.deepEqual(calls, [], 'planning must never mutate Discord');
});

test('repeated setup includes saved gates only while their Verified visibility still exists', async () => {
  const { guild, addChannel, options } = fixture();
  const gated = addChannel('gated', {
    overwrites: [
      overwrite(everyoneId, { deny: [ViewChannel] }),
      overwrite(verifiedId, { allow: [ViewChannel] }),
      overwrite(botId, { allow: [ViewChannel], type: OverwriteType.Member }),
    ],
  });
  addChannel('converted-staff', { overwrites: [overwrite(everyoneId, { deny: [ViewChannel] })] });
  addChannel('untracked-private', {
    overwrites: [overwrite(everyoneId, { deny: [ViewChannel] }), overwrite(verifiedId, { allow: [ViewChannel] })],
  });
  const plan = await buildPermissionPlan(guild, {
    ...options,
    gatedChannelIds: ['gated', 'converted-staff', 'deleted-channel'],
  });
  assert.deepEqual(plan.targets, [gated]);
  assert.deepEqual(plan.skippedPrivate, ['converted-staff', 'untracked-private']);
});

test('a newly created Verified role is optional during a read-only preview', async () => {
  const { guild, addChannel, options } = fixture();
  const channel = addChannel('general');
  const plan = await buildPermissionPlan(guild, { ...options, verifiedRoleId: null });
  assert.deepEqual(plan.targets, [channel]);
});

test('all effective bot permissions are checked before the first mutation', async () => {
  for (const missing of [ViewChannel, ManageChannels, ManageRoles]) {
    const { guild, calls, addChannel, options } = fixture();
    addChannel('first');
    addChannel('second', {
      botPermissions: new PermissionsBitField([ViewChannel, ManageChannels, ManageRoles]).remove(missing),
    });
    await assert.rejects(buildPermissionPlan(guild, options), /needs View Channel, Manage Channels, and Manage Roles/);
    assert.deepEqual(calls, []);
  }
});

test('normal-role and member ViewChannel allows block verification bypasses without mutation', async () => {
  for (const type of [OverwriteType.Role, OverwriteType.Member]) {
    const { guild, calls, addChannel, options } = fixture();
    guild.roles.cache.set('existing', { permissions: new PermissionsBitField() });
    addChannel('general', { overwrites: [overwrite('existing', { type, allow: [ViewChannel] })] });
    await assert.rejects(buildPermissionPlan(guild, options), /would bypass verification/);
    assert.deepEqual(calls, []);
  }
});

test('administrator, verified, and bot role/member allows are intentional exemptions', async () => {
  const { guild, addChannel, options } = fixture();
  guild.roles.cache.set('admin', { permissions: new PermissionsBitField(Administrator) });
  guild.roles.cache.set('bot-role', { permissions: new PermissionsBitField(), tags: { botId: 'other-bot' } });
  guild.members.cache.set('admin-member', { permissions: new PermissionsBitField(Administrator), user: { bot: false } });
  guild.members.cache.set('other-bot', { permissions: new PermissionsBitField(), user: { bot: true } });
  const channel = addChannel('general', { overwrites: [
    overwrite('admin', { allow: [ViewChannel] }),
    overwrite('bot-role', { allow: [ViewChannel] }),
    overwrite(verifiedId, { allow: [ViewChannel] }),
    ...[botId, 'owner', 'admin-member', 'other-bot'].map((id) => overwrite(id, {
      allow: [ViewChannel], type: OverwriteType.Member,
    })),
  ] });
  assert.deepEqual((await buildPermissionPlan(guild, options)).targets, [channel]);
});

test('a managed role for an integration is not treated as a bot exemption', async () => {
  const { guild, addChannel, options } = fixture();
  guild.roles.cache.set('integration', { permissions: new PermissionsBitField(), managed: true });
  addChannel('general', { overwrites: [overwrite('integration', { allow: [ViewChannel] })] });
  await assert.rejects(buildPermissionPlan(guild, options), /would bypass verification/);
});

test('private staff channel overwrites remain untouched even with staff-role visibility', async () => {
  const { guild, calls, addChannel, options } = fixture();
  const staff = addChannel('staff', {
    overwrites: [overwrite(everyoneId, { deny: [ViewChannel] }), overwrite('staff-role', { allow: [ViewChannel] })],
  });
  const before = [...staff.permissionOverwrites.cache.values()];
  const plan = await buildPermissionPlan(guild, options);
  await applyPermissionPlan(plan, { guild, verifiedRoleId: verifiedId, reason: 'test' });
  assert.deepEqual(calls, []);
  assert.deepEqual([...staff.permissionOverwrites.cache.values()], before);
});

test('everyone Administrator is rejected because channel restrictions cannot gate it', async () => {
  const { guild, calls, options } = fixture();
  guild.roles.everyone.permissions.add(Administrator);
  await assert.rejects(buildPermissionPlan(guild, options), /Remove Administrator from @everyone/);
  assert.deepEqual(calls, []);
});

test('applying gates preserves unrelated permissions and keeps the bot visible before denying everyone', async () => {
  const { guild, calls, addChannel, options } = fixture();
  const channel = addChannel('general', { overwrites: [
    overwrite(everyoneId, { allow: [SendMessages] }),
    overwrite(verifiedId, { deny: [SendMessages, ViewChannel] }),
  ] });
  const plan = await buildPermissionPlan(guild, options);
  await applyPermissionPlan(plan, { guild, verifiedRoleId: verifiedId, reason: 'VOIDTIDE rules setup' });
  assert.deepEqual(calls.map(({ target }) => target), [botId, verifiedId, everyoneId]);
  assert.equal(channel.permissionOverwrites.cache.get(everyoneId).allow.has(SendMessages), true);
  assert.equal(channel.permissionOverwrites.cache.get(verifiedId).deny.has(SendMessages), true);
  assert.equal(channel.permissionOverwrites.cache.get(verifiedId).deny.has(ViewChannel), false);
  assert.equal(channel.permissionOverwrites.cache.get(verifiedId).allow.has(ViewChannel), true);
  assert.equal(channel.permissionsFor(options.botMember).has(ViewChannel), true);
  assert.equal(channel.permissionsFor(guild.roles.everyone).has(ViewChannel), false);
  assert.equal(calls.every(({ patch }) => Object.keys(patch).join() === 'ViewChannel'), true);
  assert.equal(calls.every(({ options: callOptions }) => callOptions.reason === 'VOIDTIDE rules setup'), true);
});

test('applying an already correct gate does not send redundant permission edits', async () => {
  const { guild, calls, addChannel, options } = fixture();
  addChannel('general');
  const plan = await buildPermissionPlan(guild, options);
  await applyPermissionPlan(plan, { guild, verifiedRoleId: verifiedId, reason: 'test' });
  calls.length = 0;
  await applyPermissionPlan(plan, { guild, verifiedRoleId: verifiedId, reason: 'test' });
  assert.deepEqual(calls, []);
});

test('application errors stop immediately and are available for safe setup recovery', async () => {
  const { guild, calls, addChannel, options } = fixture();
  const first = addChannel('first');
  addChannel('second');
  const failure = Object.assign(new Error('simulated Discord failure'), { code: 50013 });
  first.permissionOverwrites.edit = async () => { throw failure; };
  const plan = await buildPermissionPlan(guild, options);
  await assert.rejects(applyPermissionPlan(plan, { guild, verifiedRoleId: verifiedId }), (error) => error === failure);
  assert.deepEqual(calls, [], 'later channel restrictions must not continue after a permission failure');
});

test('missing bot or role identity fails before any channel permissions change', async () => {
  const { guild, calls, options } = fixture();
  await assert.rejects(buildPermissionPlan(guild, { ...options, botMember: null }), /bot member could not be loaded/);
  await assert.rejects(applyPermissionPlan({ targets: [], botMemberId: botId }, { guild }), /Verified role/);
  assert.deepEqual(calls, []);
});
