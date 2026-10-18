import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelType, Collection, OverwriteType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { Store } from '../../src/database/store.js';
import { Management } from '../../src/services/management.js';
import { BOT_PERMISSIONS } from '../../src/services/server-setup.js';
import { RulesService } from '../../src/services/rules-service.js';
import { RulesStore } from '../../src/services/rules-store.js';

export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'voidtide-community-'));
  const store = new Store(join(directory, 'community.sqlite'));
  let sequence = 100000000000000100n;
  const next = () => String(sequence++);
  const calls = []; const errors = [];
  const roles = new Collection(); const channels = new Collection(); const members = new Collection();
  function role(name, permissions = [], position = 1) {
    const item = { id: next(), name, position, managed: false, editable: true, permissions: new PermissionsBitField(permissions),
      comparePositionTo(other) { return this.position - other.position; } };
    roles.set(item.id, item); return item;
  }
  const everyone = role('@everyone', [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.UseApplicationCommands, P.Connect, P.Speak], 0);
  const botRole = role('bot', BOT_PERMISSIONS, 100);
  const ownerRole = role('owner', [P.Administrator], 99);
  const client = { user: { id: next(), displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }, isReady: () => true, guilds: { cache: new Collection() } };
  const guild = { id: everyone.id, ownerId: next(), client, memberCount: 3,
    roles: { cache: roles, everyone, async fetch(id) { return id ? roles.get(id) ?? null : roles; }, async create(options) { calls.push(['role', options]); return role(options.name, options.permissions); } },
    channels: { cache: channels, async fetch(id) { return id ? channels.get(id) ?? null : channels; }, async create(options) { calls.push(['channel', options]); return addChannel(options.name, options); } },
    members: { cache: members, async fetchMe() { return members.get(client.user.id); }, async fetch(value) { const member = members.get(value.user ?? value); if (!member) throw Object.assign(new Error('Unknown Member'), { code: 10007 }); return member; } },
    scheduledEvents: { events: new Collection(), async fetch() { return this.events; }, async create(options) { calls.push(['event', options]); const value = { id: next(), ...options, url: 'https://discord.com/events/test/test' }; this.events.set(value.id, value); return value; } },
  };
  client.guilds.cache.set(guild.id, guild);
  function member(id = next(), assigned = []) {
    const cache = new Collection([[everyone.id, everyone], ...assigned.map((role) => [role.id, role])]);
    const item = { id, guild, user: { id, bot: id === client.user.id }, pending: false, joinedTimestamp: Date.now(),
      get permissions() { return new PermissionsBitField([...cache.values()].reduce((bits, role) => bits | role.permissions.bitfield, 0n)); },
      roles: { cache, get highest() { return [...cache.values()].sort((a, b) => b.position - a.position)[0]; },
        async add(value) { const role = typeof value === 'string' ? roles.get(value) : value; if (!role) throw new Error('missing role'); calls.push(['addRole', id, role.id]); cache.set(role.id, role); },
        async remove(value) { const roleId = typeof value === 'string' ? value : value.id; calls.push(['removeRole', id, roleId]); cache.delete(roleId); },
      },
      moderatable: true, kickable: true, bannable: true,
      async timeout(duration) { calls.push(['timeout', id, duration]); }, async kick() { calls.push(['kick', id]); }, async ban() { calls.push(['ban', id]); },
    };
    members.set(id, item); return item;
  }
  const bot = member(client.user.id, [botRole]); const owner = member(guild.ownerId, [ownerRole]); const ordinary = member();
  function addChannel(name, options = {}) {
    const overwrites = new Collection(); const messages = new Collection();
    const apply = (id, patch, type = roles.has(id) ? OverwriteType.Role : OverwriteType.Member) => {
      const previous = overwrites.get(id) ?? { id, type, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
      const value = { ...previous, allow: new PermissionsBitField(previous.allow), deny: new PermissionsBitField(previous.deny) };
      for (const [name, state] of Object.entries(patch)) {
        value.allow.remove(P[name]); value.deny.remove(P[name]); (state ? value.allow : value.deny).add(P[name]);
      }
      overwrites.set(id, value);
    };
    for (const overwrite of options.permissionOverwrites ?? []) overwrites.set(overwrite.id, {
      id: overwrite.id, type: roles.has(overwrite.id) ? OverwriteType.Role : OverwriteType.Member,
      allow: new PermissionsBitField(overwrite.allow ?? []), deny: new PermissionsBitField(overwrite.deny ?? []),
    });
    const channel = { id: next(), name, guild, client, type: options.type ?? ChannelType.GuildText,
      parentId: options.parent ?? null, topic: options.topic, permissionsLocked: false, nsfw: false,
      isThread: () => false, isTextBased() { return [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(this.type); },
      permissionOverwrites: { cache: overwrites, async edit(id, patch, options = {}) { calls.push(['overwrite', channel.id, id, patch]); apply(id, patch, options.type); } },
      permissionsFor(subject) {
        if (!subject) return null;
        const selectedRoles = subject.roles ? [...subject.roles.cache.values()] : [everyone, subject];
        let bits = selectedRoles.reduce((bits, role) => bits | role.permissions.bitfield, 0n);
        if (bits & P.Administrator) return new PermissionsBitField(PermissionsBitField.All);
        const base = overwrites.get(guild.id); bits = (bits & ~(base?.deny.bitfield ?? 0n)) | (base?.allow.bitfield ?? 0n);
        if (subject.id !== guild.id) {
          let deny = 0n; let allow = 0n;
          for (const role of selectedRoles.filter((role) => role.id !== guild.id)) {
            const overwrite = overwrites.get(role.id); deny |= overwrite?.deny.bitfield ?? 0n; allow |= overwrite?.allow.bitfield ?? 0n;
          }
          bits = (bits & ~deny) | allow;
          if (subject.roles) { const own = overwrites.get(subject.id); bits = (bits & ~(own?.deny.bitfield ?? 0n)) | (own?.allow.bitfield ?? 0n); }
        }
        return new PermissionsBitField(bits);
      },
      messages: { cache: messages, async fetch(options) {
        const id = typeof options === 'string' ? options : options?.message;
        if (id) { if (!messages.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 }); return messages.get(id); }
        const rows = [...messages.values()].reverse();
        const offset = options?.before ? rows.findIndex((row) => row.id === options.before) + 1 : 0;
        return new Collection(rows.slice(offset, offset + (options?.limit ?? 100)).map((row) => [row.id, row]));
      } },
      async send(payload) {
        calls.push(['send', channel.id, payload]);
        const message = { id: next(), author: client.user, createdTimestamp: Date.now(), pinned: false,
          async edit(payload) { calls.push(['edit', this.id]); Object.assign(this, serial(payload)); return this; } };
        Object.assign(message, serial(payload)); messages.set(message.id, message); return message;
      },
      async setParent(parent) { calls.push(['parent', channel.id]); this.parentId = parent; },
      async setName(name) { calls.push(['rename', channel.id]); this.name = name; },
      async delete() { calls.push(['deleteChannel', channel.id]); channels.delete(channel.id); return this; },
      async bulkDelete(collection) { for (const id of collection.keys()) messages.delete(id); calls.push(['bulkDelete', collection.size]); return collection; },
    };
    channels.set(channel.id, channel); return channel;
  }
  function serial(payload) {
    return { ...payload, embeds: (payload.embeds ?? []).map((embed) => embed.toJSON?.() ?? embed),
      components: (payload.components ?? []).map((row) => { const data = row.toJSON?.() ?? row; return { ...data, components: data.components.map((item) => ({ ...item, customId: item.custom_id })) }; }) };
  }
  const rulesService = new RulesService({ store: new RulesStore(join(directory, 'rules.json')) });
  const logger = { info() {}, error(...args) { errors.push(args); } };
  const management = new Management({ client, guildId: guild.id, logger, rulesService, store, environment: {} });
  t.after(async () => { await management.shutdown(); await rm(directory, { recursive: true, force: true }); });
  function interaction(name, values = {}, actor = owner) {
    const request = { id: next(), commandName: name, user: actor.user, member: actor, guild, guildId: guild.id,
      memberPermissions: actor.permissions, channelId: values.channelId, message: values.message,
      options: {
        getBoolean: (key) => values[key] ?? null, getString: (key) => values[key] ?? null,
        getInteger: (key) => values[key] ?? null, getUser: (key) => values[key] ?? null,
        getChannel: (key) => values[key] ?? null, getSubcommand: () => values.subcommand,
      }, isButton: () => false,
    };
    return request;
  }
  async function setup() { await management.execute(interaction('setup-server')); return management.execute(interaction('setup-server', { confirm: true })); }
  return { store, guild, client, bot, botRole, owner, ordinary, member, role, addChannel, calls, errors, management, rulesService, interaction, setup };
}
