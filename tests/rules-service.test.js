import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChannelType, Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { RulesError } from '../src/services/rules-errors.js';
import { RULES_AGREE_BUTTON_ID, RULES_CHANNEL_NAME, VERIFIED_ROLE_NAME, rulesPayload } from '../src/services/rules-payload.js';
import { RulesService } from '../src/services/rules-service.js';
import { RulesStore } from '../src/services/rules-store.js';

const { Administrator, EmbedLinks, ManageChannels, ManageRoles, ReadMessageHistory, SendMessages, ViewChannel } = PermissionFlagsBits;
const guildId = '100000000000000001';
const botId = '100000000000000002';
const administratorId = '100000000000000003';
const memberId = '100000000000000004';

function makeOverwrite(id, allow = [], deny = [], type = OverwriteType.Role) {
  return { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

function discordComponents(rows = []) {
  return rows.map((builder) => {
    const row = typeof builder.toJSON === 'function' ? builder.toJSON() : builder;
    return { ...row, components: row.components.map((button) => ({ ...button, customId: button.custom_id ?? button.customId })) };
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'voidtide-service-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'rules.json');
  const store = new RulesStore(filePath);
  const calls = [];
  const fetches = [];
  let sequence = 10;
  let now = 1_000_000;
  const permissions = new PermissionsBitField([ViewChannel, SendMessages, EmbedLinks, ReadMessageHistory, ManageRoles, ManageChannels]);
  const everyone = {
    id: guildId, name: '@everyone', position: 0, managed: false,
    permissions: new PermissionsBitField([ViewChannel, SendMessages, ReadMessageHistory]),
  };
  const roles = new Collection([[guildId, everyone]]);
  const channels = new Collection();
  const members = new Collection();
  const botRole = { id: 'bot-role', name: 'VOIDTIDE Bot', position: 100, permissions, tags: { botId },
    comparePositionTo: (role) => 100 - role.position };
  roles.set(botRole.id, botRole);
  const botMember = { id: botId, permissions, user: { id: botId, bot: true },
    roles: { highest: botRole, cache: new Collection([[botRole.id, botRole]]) } };
  const member = {
    id: memberId, user: { id: memberId, bot: false }, pending: false,
    roles: { cache: new Collection([[guildId, everyone]]), async add(role, reason) {
      calls.push(['addRole', role.id ?? role, reason]);
      this.cache.set(role.id ?? role, typeof role === 'string' ? roles.get(role) : role);
      return member;
    } },
  };
  const administrator = { id: administratorId,
    permissions: new PermissionsBitField(Administrator), user: { id: administratorId, bot: false } };
  for (const entry of [botMember, member, administrator]) members.set(entry.id, entry);
  const guild = {
    id: guildId, ownerId: administratorId, name: 'VOIDTIDE', client: { user: { id: botId } },
    roles: { cache: roles, everyone,
      async fetch(id) { fetches.push(['roles', id]); return id ? roles.get(id) ?? null : roles; },
      async create(options) {
        calls.push(['createRole', options]);
        return addRole(options.name, { permissions: options.permissions ?? [] });
      },
    },
    channels: { cache: channels,
      async fetch(id) { fetches.push(['channels', id]); return id ? channels.get(id) ?? null : channels; },
      async create(options) {
        calls.push(['createChannel', options]);
        return addChannel(options.name, { type: options.type, overwrites: options.permissionOverwrites });
      },
    },
    members: { cache: members, me: botMember,
      async fetchMe() { fetches.push(['bot']); return botMember; },
      async fetch(options) {
        const id = typeof options === 'string' ? options : options?.user;
        fetches.push(['member', id]);
        return members.get(id) ?? null;
      },
    },
  };

  function addRole(name = VERIFIED_ROLE_NAME, options = {}) {
    const id = options.id ?? `role-${sequence++}`;
    const role = {
      id, name, position: 1, editable: true, managed: false,
      permissions: new PermissionsBitField(options.permissions ?? []),
      comparePositionTo(other) { return this.position - other.position; },
      ...options,
    };
    if (!(role.permissions instanceof PermissionsBitField)) role.permissions = new PermissionsBitField(role.permissions);
    roles.set(id, role);
    return role;
  }

  function addChannel(name, { type = ChannelType.GuildText, overwrites = [], id = `channel-${sequence++}` } = {}) {
    const overwriteCache = new Collection(overwrites.map((entry) => {
      const value = makeOverwrite(entry.id, entry.allow ?? [], entry.deny ?? [], entry.type ?? OverwriteType.Role);
      return [value.id, value];
    }));
    const messageCache = new Collection();
    const channel = {
      id, name, type, guild, parentId: null, manageable: true, viewable: true,
      isThread: () => false, isTextBased: () => type === ChannelType.GuildText,
      isSendable: () => type === ChannelType.GuildText,
      async setParent(parentId, options) {
        calls.push(['setParent', id, parentId, options]);
        this.parentId = parentId;
        this.permissionsLocked = false;
        return channel;
      },
      permissionOverwrites: {
        cache: overwriteCache,
        async edit(target, patch, options = {}) {
          const targetId = target.id ?? target;
          calls.push(['overwrite', id, targetId, patch]);
          const entry = overwriteCache.get(targetId) ?? makeOverwrite(targetId, [], [], options.type);
          for (const [key, value] of Object.entries(patch)) {
            if (value === true) { entry.allow.add(PermissionFlagsBits[key]); entry.deny.remove(PermissionFlagsBits[key]); }
            else if (value === false) { entry.deny.add(PermissionFlagsBits[key]); entry.allow.remove(PermissionFlagsBits[key]); }
            else { entry.allow.remove(PermissionFlagsBits[key]); entry.deny.remove(PermissionFlagsBits[key]); }
          }
          overwriteCache.set(targetId, entry);
          return channel;
        },
      },
      permissionsFor(subject) {
        const result = new PermissionsBitField(guild.roles.everyone.permissions).add(subject.permissions ?? 0n);
        const everyoneOverwrite = overwriteCache.get(guildId);
        if (everyoneOverwrite) { result.remove(everyoneOverwrite.deny); result.add(everyoneOverwrite.allow); }
        const ownOverwrite = overwriteCache.get(subject.id);
        if (ownOverwrite) { result.remove(ownOverwrite.deny); result.add(ownOverwrite.allow); }
        return result;
      },
      messages: { cache: messageCache,
        async fetch(options) {
          if (typeof options === 'string' || options?.message) {
            const value = messageCache.get(typeof options === 'string' ? options : options.message);
            if (!value) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
            return value;
          }
          const ordered = [...messageCache.values()].reverse();
          const offset = options?.before ? ordered.findIndex((message) => message.id === options.before) + 1 : 0;
          return new Collection(ordered.slice(offset, offset + (options?.limit ?? 100)).map((message) => [message.id, message]));
        },
      },
      async send(payload) {
        calls.push(['send', id, payload]);
        return addMessage(channel, payload);
      },
    };
    channels.set(id, channel);
    return channel;
  }

  function addMessage(channel, payload = rulesPayload({ verification: true }), options = {}) {
    const id = options.id ?? `message-${sequence++}`;
    const message = {
      id, channelId: channel.id, guildId, author: { id: botId, bot: true },
      webhookId: null, editable: true, components: discordComponents(payload.components),
      embeds: payload.embeds ?? [],
      async edit(update) {
        calls.push(['editMessage', id, update]);
        this.components = discordComponents(update.components);
        this.embeds = update.embeds;
        return this;
      },
      ...options,
    };
    channel.messages.cache.set(id, message);
    return message;
  }

  const service = new RulesService({ store, clock: () => now });
  return { guild, botMember, member, service, store, filePath, calls, fetches, addRole, addChannel, addMessage,
    setTime(value) { now = value; },
    click(settings, overrides = {}) {
      return { guild, guildId, channelId: settings.rulesChannelId, message: { id: settings.rulesMessageId },
        user: { id: memberId, bot: false }, member, customId: RULES_AGREE_BUTTON_ID, ...overrides };
    },
  };
}

test('a rules preview describes permission changes without mutating Discord or persistent settings', async (t) => {
  const { guild, service, store, calls, fetches, addChannel } = await fixture(t);
  addChannel('general');
  const result = await service.preview(guild, administratorId);
  assert.equal(typeof result, 'string');
  assert.match(result, /confirm/i);
  assert.match(result, /Verified/);
  assert.match(result, /rules/);
  assert.deepEqual(calls, []);
  assert.equal(await store.get(guildId), null);
  assert.ok(fetches.some(([kind]) => kind === 'roles'));
  assert.ok(fetches.some(([kind]) => kind === 'channels'));
  assert.ok(fetches.some(([kind]) => kind === 'bot'));
});

test('setup requires a recent review by the same administrator', async (t) => {
  const { guild, service, calls, setTime } = await fixture(t);
  await assert.rejects(service.setup(guild, administratorId), RulesError);
  await service.preview(guild, administratorId);
  await assert.rejects(service.setup(guild, 'other-administrator'), RulesError);
  setTime(1_000_000 + 10 * 60 * 1000 + 1);
  await assert.rejects(service.setup(guild, administratorId), RulesError);
  assert.deepEqual(calls, []);
});

test('a changed channel permission plan invalidates approval before creating or gating resources', async (t) => {
  const { guild, service, calls, addChannel } = await fixture(t);
  addChannel('general');
  await service.preview(guild, administratorId);
  addChannel('new-channel-after-preview');
  await assert.rejects(service.setup(guild, administratorId), RulesError);
  assert.deepEqual(calls, []);
});

test('setup persists one zero-permission Verified role, rules channel, panel, and recoverable channel gates', async (t) => {
  const { guild, service, store, calls, addChannel } = await fixture(t);
  const general = addChannel('general');
  await service.preview(guild, administratorId);
  const response = await service.setup(guild, administratorId);
  assert.equal(typeof response, 'string');
  const settings = await store.get(guildId);
  assert.equal(settings.complete, true);
  assert.ok(settings.gatedChannelIds.includes(general.id));
  const role = guild.roles.cache.get(settings.verifiedRoleId);
  const channel = guild.channels.cache.get(settings.rulesChannelId);
  assert.equal(role.name, VERIFIED_ROLE_NAME);
  assert.equal(role.permissions.bitfield, 0n);
  assert.equal(channel.name, RULES_CHANNEL_NAME);
  assert.equal(channel.messages.cache.size, 1);
  assert.ok(channel.messages.cache.has(settings.rulesMessageId));
  assert.equal(channel.permissionsFor(guild.roles.everyone).has([ViewChannel, ReadMessageHistory]), true);
  assert.equal(channel.permissionsFor(guild.roles.everyone).has(SendMessages), false);
  assert.equal(general.permissionsFor(guild.roles.everyone).has(ViewChannel), false);
  assert.equal(general.permissionOverwrites.cache.get(role.id).allow.has(ViewChannel), true);
  assert.equal(calls.filter(([kind]) => kind === 'createRole').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'createChannel').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'send').length, 1);
});

test('repeating setup after a process restart reuses persisted resources and the original panel', async (t) => {
  const { guild, service, store, filePath, calls, addChannel } = await fixture(t);
  addChannel('general');
  await service.preview(guild, administratorId);
  await service.setup(guild, administratorId);
  const original = await store.get(guildId);
  calls.length = 0;
  const restarted = new RulesService({ store: new RulesStore(filePath) });
  await restarted.preview(guild, administratorId);
  await restarted.setup(guild, administratorId);
  const current = await store.get(guildId);
  assert.equal(current.rulesMessageId, original.rulesMessageId);
  assert.equal(current.rulesChannelId, original.rulesChannelId);
  assert.equal(current.verifiedRoleId, original.verifiedRoleId);
  assert.equal(current.complete, true);
  assert.deepEqual(calls.filter(([kind]) => ['createRole', 'createChannel', 'send'].includes(kind)), []);
});

test('an existing bot panel can be recovered without a saved message ID', async (t) => {
  const { guild, service, store, calls, addRole, addChannel, addMessage } = await fixture(t);
  const role = addRole();
  const channel = addChannel(RULES_CHANNEL_NAME);
  const panel = addMessage(channel);
  await service.preview(guild, administratorId);
  await service.setup(guild, administratorId);
  const settings = await store.get(guildId);
  assert.equal(settings.verifiedRoleId, role.id);
  assert.equal(settings.rulesChannelId, channel.id);
  assert.equal(settings.rulesMessageId, panel.id);
  assert.deepEqual(calls.filter(([kind]) => ['createRole', 'createChannel', 'send'].includes(kind)), []);
});

test('panel recovery scans beyond the latest 100 messages before posting anything', async (t) => {
  const { guild, service, store, calls, addRole, addChannel, addMessage } = await fixture(t);
  addRole();
  const channel = addChannel(RULES_CHANNEL_NAME);
  const panel = addMessage(channel);
  for (let count = 0; count < 100; count++) addMessage(channel, { components: [], embeds: [] });
  await service.preview(guild, administratorId);
  await service.setup(guild, administratorId);
  assert.equal((await store.get(guildId)).rulesMessageId, panel.id);
  assert.equal(calls.some(([kind]) => kind === 'send'), false);
});

test('a synchronized rules channel leaves a gated category before access restrictions are applied', async (t) => {
  const f = await fixture(t);
  const category = f.addChannel('Information', { type: ChannelType.GuildCategory });
  const rulesChannel = f.addChannel(RULES_CHANNEL_NAME);
  rulesChannel.parentId = category.id;
  rulesChannel.permissionsLocked = true;
  await f.service.preview(f.guild, administratorId);
  await f.service.setup(f.guild, administratorId);
  const movedAt = f.calls.findIndex(([kind, id]) => kind === 'setParent' && id === rulesChannel.id);
  const gatedAt = f.calls.findIndex(([kind, id, target, patch]) => kind === 'overwrite'
    && id === category.id && target === guildId && patch.ViewChannel === false);
  assert.ok(movedAt >= 0 && gatedAt > movedAt);
  assert.equal(rulesChannel.parentId, null);
  assert.equal(rulesChannel.permissionsFor(f.guild.roles.everyone).has(ViewChannel), true);
});

test('a storage failure after sending the panel does not gate anyone or create a duplicate on restart', async (t) => {
  const f = await fixture(t);
  const general = f.addChannel('general');
  const save = f.store.set.bind(f.store);
  f.store.set = async (id, patch) => {
    if (patch.rulesMessageId) throw new RulesError('The rules configuration could not be saved.');
    return save(id, patch);
  };
  await f.service.preview(f.guild, administratorId);
  await assert.rejects(f.service.setup(f.guild, administratorId), RulesError);
  const incomplete = await f.store.get(guildId);
  const channel = f.guild.channels.cache.get(incomplete.rulesChannelId);
  assert.equal(incomplete.rulesMessageId, undefined);
  assert.equal(channel.messages.cache.size, 1);
  const panelId = channel.messages.cache.first().id;
  assert.equal(general.permissionsFor(f.guild.roles.everyone).has(ViewChannel), true);
  f.calls.length = 0;
  const freshStore = new RulesStore(f.filePath);
  const restarted = new RulesService({ store: freshStore });
  await restarted.preview(f.guild, administratorId);
  await restarted.setup(f.guild, administratorId);
  assert.equal((await freshStore.get(guildId)).rulesMessageId, panelId);
  assert.equal(channel.messages.cache.size, 1);
  assert.equal(f.calls.some(([kind]) => kind === 'send'), false);
});

test('partial permission failures preserve the accessible panel and durable gates for restart recovery', async (t) => {
  const f = await fixture(t);
  const first = f.addChannel('general', { id: 'first' });
  const second = f.addChannel('gaming', { id: 'second' });
  let blocked = true;
  for (const channel of [first, second]) {
    const edit = channel.permissionOverwrites.edit;
    channel.permissionOverwrites.edit = async (target, patch, options) => {
      if (target === guildId && patch.ViewChannel === false) {
        const state = await f.store.get(guildId);
        assert.equal(state.complete, false);
        assert.deepEqual(new Set(state.gatedChannelIds), new Set([first.id, second.id]));
        const rulesChannel = f.guild.channels.cache.get(state.rulesChannelId);
        assert.ok(rulesChannel.messages.cache.has(state.rulesMessageId), 'panel exists before any public access is removed');
        assert.equal(rulesChannel.permissionsFor(f.guild.roles.everyone).has([ViewChannel, ReadMessageHistory]), true);
        if (channel === second && blocked) {
          throw Object.assign(new Error('private simulated permission request'), { code: 50013 });
        }
      }
      return edit(target, patch, options);
    };
  }
  await f.service.preview(f.guild, administratorId);
  await assert.rejects(f.service.setup(f.guild, administratorId), (error) => {
    assert.ok(error instanceof RulesError);
    assert.match(error.message, /denied access/i);
    assert.doesNotMatch(error.message, /private simulated permission request/);
    return true;
  });
  const partial = await f.store.get(guildId);
  assert.equal(partial.complete, false);
  assert.equal(first.permissionsFor(f.guild.roles.everyone).has(ViewChannel), false);
  assert.equal(second.permissionsFor(f.guild.roles.everyone).has(ViewChannel), true);
  blocked = false;
  f.calls.length = 0;
  const restarted = new RulesService({ store: new RulesStore(f.filePath) });
  await restarted.preview(f.guild, administratorId);
  await restarted.setup(f.guild, administratorId);
  const recovered = await f.store.get(guildId);
  assert.equal(recovered.complete, true);
  assert.equal(recovered.rulesMessageId, partial.rulesMessageId);
  assert.deepEqual(new Set(recovered.gatedChannelIds), new Set([first.id, second.id]));
  assert.equal(second.permissionsFor(f.guild.roles.everyone).has(ViewChannel), false);
  assert.deepEqual(f.calls.filter(([kind]) => ['createRole', 'createChannel', 'send'].includes(kind)), []);
});

test('ambiguous named resources and duplicate bot panels fail safely instead of creating more', async (t) => {
  for (const ambiguity of ['roles', 'channels', 'messages']) {
    const { guild, service, calls, addRole, addChannel, addMessage } = await fixture(t);
    if (ambiguity === 'roles') { addRole(); addRole(); }
    if (ambiguity === 'channels') { addChannel(RULES_CHANNEL_NAME); addChannel(RULES_CHANNEL_NAME); }
    if (ambiguity === 'messages') {
      addRole();
      const channel = addChannel(RULES_CHANNEL_NAME);
      addMessage(channel); addMessage(channel);
    }
    await assert.rejects(async () => {
      await service.preview(guild, administratorId);
      await service.setup(guild, administratorId);
    }, RulesError);
    assert.deepEqual(calls.filter(([kind]) => ['createRole', 'createChannel', 'send'].includes(kind)), []);
  }
});

test('missing bot permissions and an uneditable or privileged Verified role fail before mutations', async (t) => {
  for (const change of [
    (f) => f.botMember.permissions.remove(ManageRoles),
    (f) => f.botMember.permissions.remove(ManageChannels),
    (f) => f.addRole(VERIFIED_ROLE_NAME, { editable: false }),
    (f) => f.addRole(VERIFIED_ROLE_NAME, { permissions: [Administrator] }),
  ]) {
    const f = await fixture(t);
    f.addChannel('general');
    change(f);
    await assert.rejects(async () => {
      await f.service.preview(f.guild, administratorId);
      await f.service.setup(f.guild, administratorId);
    }, RulesError);
    assert.deepEqual(f.calls, []);
  }
});

test('an existing Verified role cannot expose private staff channels or channel-level staff permissions', async (t) => {
  for (const privateAccess of [true, false]) {
    const f = await fixture(t);
    const role = f.addRole();
    f.addChannel(privateAccess ? 'staff' : 'general', { overwrites: [
      ...(privateAccess ? [{ id: guildId, deny: [ViewChannel] }] : []),
      { id: role.id, allow: privateAccess ? [ViewChannel] : [ManageRoles] },
    ] });
    await assert.rejects(f.service.preview(f.guild, administratorId), (error) => {
      assert.ok(error instanceof RulesError);
      assert.match(error.message, privateAccess ? /private channel/ : /staff permission/);
      return true;
    });
    assert.deepEqual(f.calls, []);
  }
});

test('verification rejects a copied or outdated panel and refuses to assign any role', async (t) => {
  const f = await fixture(t);
  await f.service.preview(f.guild, administratorId);
  await f.service.setup(f.guild, administratorId);
  const settings = await f.store.get(guildId);
  f.calls.length = 0;
  for (const overrides of [{ channelId: 'copied-channel' }, { message: { id: 'outdated-message' } }]) {
    await assert.rejects(f.service.verify(f.click(settings, overrides)), RulesError);
  }
  assert.deepEqual(f.calls, []);
});

test('verification fetches the member fresh, assigns Verified once, and handles concurrent repeated clicks', async (t) => {
  const f = await fixture(t);
  await f.service.preview(f.guild, administratorId);
  await f.service.setup(f.guild, administratorId);
  const settings = await f.store.get(guildId);
  f.calls.length = 0;
  f.fetches.length = 0;
  const results = await Promise.all([
    f.service.verify(f.click(settings)),
    f.service.verify(f.click(settings)),
  ]);
  assert.ok(results.every((result) => typeof result === 'string'));
  assert.equal(f.member.roles.cache.has(settings.verifiedRoleId), true);
  assert.equal(f.calls.filter(([kind]) => kind === 'addRole').length, 1);
  assert.ok(f.fetches.some(([kind, id]) => kind === 'member' && id === memberId));
  assert.ok(f.fetches.some(([kind]) => kind === 'bot'));
  assert.ok(f.fetches.some(([kind]) => kind === 'roles'));
});

test('verification does not assign roles to bots or members pending Discord screening', async (t) => {
  for (const change of [(f) => { f.member.user.bot = true; }, (f) => { f.member.pending = true; }]) {
    const f = await fixture(t);
    await f.service.preview(f.guild, administratorId);
    await f.service.setup(f.guild, administratorId);
    const settings = await f.store.get(guildId);
    f.calls.length = 0;
    change(f);
    await assert.rejects(f.service.verify(f.click(settings)), RulesError);
    assert.deepEqual(f.calls, []);
  }
});

test('verification detects lost Manage Roles or role hierarchy access without adding a role', async (t) => {
  for (const change of [
    (f) => f.botMember.permissions.remove(ManageRoles),
    (f, settings) => { f.guild.roles.cache.get(settings.verifiedRoleId).editable = false; },
  ]) {
    const f = await fixture(t);
    await f.service.preview(f.guild, administratorId);
    await f.service.setup(f.guild, administratorId);
    const settings = await f.store.get(guildId);
    f.calls.length = 0;
    change(f, settings);
    await assert.rejects(f.service.verify(f.click(settings)), RulesError);
    assert.deepEqual(f.calls, []);
  }
});

test('verification rechecks newly granted private access and channel staff permissions before assigning Verified', async (t) => {
  for (const privateAccess of [true, false]) {
    const f = await fixture(t);
    await f.service.preview(f.guild, administratorId);
    await f.service.setup(f.guild, administratorId);
    const settings = await f.store.get(guildId);
    f.addChannel(privateAccess ? 'staff' : 'new-channel', { overwrites: [
      ...(privateAccess ? [{ id: guildId, deny: [ViewChannel] }] : []),
      { id: settings.verifiedRoleId, allow: privateAccess ? [ViewChannel] : [ManageRoles] },
    ] });
    f.calls.length = 0;
    await assert.rejects(f.service.verify(f.click(settings)), RulesError);
    assert.deepEqual(f.calls, []);
  }
});

test('a deleted saved role stops setup even when a new same-name role could be adopted', async (t) => {
  for (const replacement of [false, true]) {
    const f = await fixture(t);
    f.addChannel('general');
    await f.service.preview(f.guild, administratorId);
    await f.service.setup(f.guild, administratorId);
    const settings = await f.store.get(guildId);
    f.guild.roles.cache.delete(settings.verifiedRoleId);
    for (const channel of f.guild.channels.cache.values()) {
      channel.permissionOverwrites.cache.delete(settings.verifiedRoleId);
    }
    if (replacement) f.addRole();
    f.calls.length = 0;
    await assert.rejects(f.service.preview(f.guild, administratorId), /saved Verified role was deleted/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual((await f.store.get(guildId)).gatedChannelIds, settings.gatedChannelIds);
  }
});

test('authoritative role responses take precedence over a stale cached deleted role', async (t) => {
  const f = await fixture(t);
  f.addChannel('general');
  await f.service.preview(f.guild, administratorId);
  await f.service.setup(f.guild, administratorId);
  const settings = await f.store.get(guildId);
  f.guild.roles.fetch = async () => new Collection(
    [...f.guild.roles.cache].filter(([id]) => id !== settings.verifiedRoleId),
  );
  f.calls.length = 0;
  await assert.rejects(f.service.preview(f.guild, administratorId), /saved Verified role was deleted/);
  await assert.rejects(f.service.verify(f.click(settings)), /Verified is missing/);
  assert.deepEqual(f.calls, []);
});

test('age-restricted rules channels are refused before setup changes anything', async (t) => {
  const f = await fixture(t);
  const channel = f.addChannel(RULES_CHANNEL_NAME);
  channel.nsfw = true;
  await assert.rejects(f.service.preview(f.guild, administratorId), /age-restricted/);
  assert.deepEqual(f.calls, []);
});
