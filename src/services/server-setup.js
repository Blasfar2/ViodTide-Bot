import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { Buffer } from 'node:buffer';
import { ROLE_DEFINITIONS, LAYOUT, STAFF_ROLES, READONLY } from '../config/server-layout.js';
import { configFor, digest, requirePermission, UserError } from './management-utils.js';

export const BOT_PERMISSIONS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory,
  P.ManageChannels, P.ManageRoles, P.ManageMessages, P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageEvents];

function candidate(collection, id, name, type) {
  const saved = id && collection.get(id);
  const matches = [...collection.values()].filter((item) => item.name.toLowerCase() === name.toLowerCase());
  if (matches.length > 1 || (saved && matches.some((item) => item.id !== saved.id))) throw new UserError(`Duplicate candidates for ${name}. Resolve them manually; setup never deletes resources.`);
  const item = saved || matches[0];
  if (item && type !== undefined && item.type !== type) throw new UserError(`The existing ${name} has the wrong channel type.`);
  return item;
}
export class ServerSetup {
  constructor(services) { Object.assign(this, services); this.previews = new Map(); }
  async inspect(guild, scope, members) {
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    const me = await guild.members.fetchMe({ force: true });
    if (!me.permissions.has(BOT_PERMISSIONS)) throw new UserError('The bot needs View/Send/Embed/Attach/History, Manage Channels/Roles/Messages/Events, Moderate Members, Kick Members, and Ban Members. No Administrator is needed. See README before granting them.');
    const config = configFor(this.store, guild.id);
    const legacy = await this.rulesService.store.get(guild.id) ?? {};
    const roleMap = { ...config.roles, ...(legacy.verifiedRoleId ? { Verified: legacy.verifiedRoleId } : {}) };
    const plannedRoles = ROLE_DEFINITIONS.map(([name, permissions]) => {
      const role = candidate(roles, roleMap[name], name);
      const ownManagedBot = name === 'VOIDTIDE Bot' && role?.managed && role.tags?.botId === me.id;
      if (role && !ownManagedBot && (!role.editable || role.managed || role.permissions.bitfield !== new (me.permissions.constructor)(permissions).bitfield)) throw new UserError(`Existing role ${name} has incompatible permissions or hierarchy. Review it manually before setup; no permissions will be overwritten.`);
      if (name === 'Verified' && legacy.verifiedRoleId && !roles.has(legacy.verifiedRoleId) && legacy.gatedChannelIds?.length) throw new UserError('Recover the deleted Verified mapping using the rules recovery guide before full setup.');
      return { name, permissions, role };
    });
    const plannedChannels = [];
    const rulesInspection = scope === 'server' ? await this.rulesService.inspect(guild, { additionalGatedChannelIds: config.managedGates ?? [] }) : null;
    if (scope !== 'roles') for (const [category, names] of LAYOUT) {
      const parent = candidate(channels, config.categories?.[category], category, ChannelType.GuildCategory);
      plannedChannels.push({ name: category, category, type: ChannelType.GuildCategory, channel: parent, staff: category === 'STAFF' });
      for (const name of names) {
        const type = category === 'VOICE' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const channel = candidate(channels, name === '📜・rules' ? legacy.rulesChannelId : config.channels?.[name], name, type);
        plannedChannels.push({ name, category, type, channel, staff: category === 'STAFF' });
      }
    }
    for (const item of plannedChannels) if (item.channel) {
      const channel = item.channel;
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) throw new UserError(`The bot cannot safely manage ${item.name}. Review its channel permissions first.`);
      if (item.staff) {
        const verified = roleMap.Verified && roles.get(roleMap.Verified);
        if (channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel) || (verified && channel.permissionsFor(verified).has(P.ViewChannel))) throw new UserError(`Existing staff resource ${item.name} is visible to ordinary members. Make it private manually before setup.`);
        const staffIds = STAFF_ROLES.map((name) => plannedRoles.find((item) => item.name === name)?.role?.id);
        for (const overwrite of channel.permissionOverwrites.cache.values()) {
          const role = roles.get(overwrite.id);
          if (overwrite.allow.has(P.ViewChannel, false) && ![me.id, guild.ownerId, ...staffIds].includes(overwrite.id)
            && !role?.permissions.has(P.Administrator)) throw new UserError(`Existing staff resource ${item.name} has an unrelated visibility grant. Review it before setup.`);
        }
      }
      if (item.name === 'welcome' && !channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel)
        && !legacy.gatedChannelIds?.includes(channel.id)) throw new UserError('The existing welcome channel is private. Review it manually before making it the newcomer welcome channel.');
    }
    const fingerprint = digest({ scope, members, roles: [...roles.values()].map((r) => [r.id, r.name, r.position, r.permissions.bitfield.toString()]).sort(),
      channels: [...channels.values()].map((c) => [c.id, c.name, c.type, c.parentId,
        [...(c.permissionOverwrites?.cache.values() ?? [])].map((o) => [o.id, o.type, o.allow.bitfield.toString(), o.deny.bitfield.toString()]).sort()]).sort() });
    return { config, legacy, me, plannedRoles, plannedChannels, fingerprint, rulesInspection };
  }
  async run(interaction, scope) {
    requirePermission(interaction);
    const members = Object.fromEntries(['badr', 'yacin', 'nisrine', 'mehdi'].map((name) => [name, interaction.options.getUser(name)?.id]).filter(([, id]) => id));
    if (Object.keys(members).length && interaction.user.id !== interaction.guild.ownerId) throw new UserError('Only the server owner can select and confirm team member IDs. Names never grant roles.');
    return this.store.lock(`setup:${interaction.guildId}`, async () => {
      const plan = await this.inspect(interaction.guild, scope, members);
      const key = `${interaction.guildId}:${interaction.user.id}:${scope}`;
      if (interaction.options.getBoolean('confirm') !== true) {
        this.previews.set(key, { hash: plan.fingerprint, expires: Date.now() + 600_000 });
        const newRoles = plan.plannedRoles.filter((r) => !r.role).map((r) => r.name);
        const newChannels = plan.plannedChannels.filter((c) => !c.channel).map((c) => c.name);
        const detail = { scope, expiresInMinutes: 10, ownerSelectedTeamIds: members,
          roles: plan.plannedRoles.map((r) => ({ name: r.name, id: r.role?.id ?? null, action: r.role ? 'reuse unchanged' : 'create', permissions: r.permissions.map((bit) => Object.keys(P).find((name) => P[name] === bit)) })),
          channels: plan.plannedChannels.map((c) => ({ name: c.name, id: c.channel?.id ?? null, category: c.category, type: c.type, action: c.channel ? 'reuse; keep existing permissions except reviewed welcome/rules access' : 'create with explicit private/verified/public permissions', staffOnly: c.staff })),
          existingGates: plan.rulesInspection?.plan.targets.filter((c) => c.name !== 'welcome').map((c) => ({ id: c.id, name: c.name, denyEveryoneView: true, allowVerifiedAndBotView: true })) ?? [],
          newcomerPublicChannels: ['welcome', '📜・rules'], existingMembersMustVerify: scope === 'server', automaticDeletion: false,
        };
        return { files: [{ attachment: Buffer.from(JSON.stringify(detail, null, 2)), name: 'voidtide-setup-preview.json' }], content: [
          `**VOIDTIDE ${scope} setup preview**`,
          `Create ${newRoles.length} missing roles: ${newRoles.join(', ') || 'none'}.`,
          `Create ${newChannels.length} missing categories/channels: ${newChannels.join(', ') || 'none'}.`,
          'Existing resources are reused; nothing is deleted or renamed. Staff resources must already be private. Founder, Co-Founder and Moderator get the listed moderation/event powers; no role receives Administrator.',
          scope === 'server' ? 'Publish/reuse rules, ticket and role panels; configure welcome, XP/rewards, announcement and private log channels. Gate public community access behind Verified; welcome and rules remain public. Existing unverified members must agree too. Rules/welcome may be detached from a gated category to retain access.' : 'This scope creates the listed resources only. Run /setup-server to activate all services and verification.',
          Object.keys(members).length ? `**Owner-selected team IDs:** ${Object.entries(members).map(([name, id]) => `${name}: ${id}`).join(', ')}. Only these selected IDs receive the corresponding roles.` : 'No team roles will be assigned to members.',
          `Read the attached complete plan and README permissions. Repeat **/setup-${scope} confirm:true** with the same team options within 10 minutes to apply.`,
        ].join('\n').slice(0, 1990) };
      }
      const reviewed = this.previews.get(key);
      if (!reviewed || reviewed.expires < Date.now() || reviewed.hash !== plan.fingerprint) throw new UserError('Run a fresh setup preview with the same options before confirming; roles or channels may have changed.');
      this.previews.delete(key);
      return this.apply(interaction, scope, members, plan);
    });
  }
  async apply(interaction, scope, members, plan) {
    const guild = interaction.guild;
    const config = { ...plan.config, roles: { ...plan.config.roles }, channels: { ...plan.config.channels }, categories: { ...plan.config.categories } };
    const save = () => this.store.set(guild.id, 'config', 'server', config);
    const reason = `Confirmed VOIDTIDE setup by ${interaction.user.id}`;
    for (const item of plan.plannedRoles) {
      const role = item.role ?? await guild.roles.create({ name: item.name, permissions: item.permissions, reason });
      config.roles[item.name] = role.id; save();
    }
    for (const [name, id] of Object.entries(members)) {
      const member = await guild.members.fetch({ user: id, force: true });
      if (member.user.bot) throw new UserError('Team assignments must select human members.');
      await member.roles.add(config.roles[name === 'badr' ? 'VOIDTIDE Founder' : 'Co-Founder'], reason);
      config.team = { ...config.team, [name]: id }; save();
    }
    const newlyGated = [];
    for (const item of plan.plannedChannels) {
      let channel = item.channel;
      if (!channel) {
        const publicInfo = ['welcome', '📜・rules'].includes(item.name);
        const overrides = [
          { id: guild.id, [publicInfo ? 'allow' : 'deny']: [P.ViewChannel], deny: publicInfo ? [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads] : [P.ViewChannel] },
          { id: config.roles.Verified, [item.staff ? 'deny' : 'allow']: [P.ViewChannel] },
          { id: plan.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles] },
          ...(item.staff ? STAFF_ROLES.map((name) => ({ id: config.roles[name], allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })) : []),
        ];
        if (READONLY.has(item.name)) overrides[1].deny = [...(overrides[1].deny ?? []), P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads];
        channel = await guild.channels.create({ name: item.name, type: item.type,
          ...(item.type !== ChannelType.GuildCategory ? { parent: config.categories[item.category] } : {}),
          permissionOverwrites: overrides, reason,
          ...(item.name === 'sign-language' ? { topic: 'Text-first communication for Deaf, hard-of-hearing, and hearing members. Important information is always available in writing.' } : {}),
        });
        if (!item.staff && !publicInfo) {
          newlyGated.push(channel.id);
          config.managedGates = [...new Set([...(config.managedGates ?? []), channel.id])];
        }
      }
      if (item.type === ChannelType.GuildCategory) config.categories[item.name] = channel.id;
      else config.channels[item.name] = channel.id;
      save();
    }
    config.rolesReady = true;
    if (scope !== 'roles') config.channelsReady = true;
    save();
    if (scope === 'server') {
      const welcome = await guild.channels.fetch(config.channels.welcome);
      if (welcome.parentId) await welcome.setParent(null, { lockPermissions: false, reason });
      await welcome.permissionOverwrites.edit(guild.id, { ViewChannel: true, ReadMessageHistory: true, UseApplicationCommands: true, SendMessages: false }, { reason });
      const state = await this.rulesService.store.get(guild.id) ?? {};
      await this.rulesService.store.set(guild.id, { verifiedRoleId: config.roles.Verified,
        publicChannelIds: [welcome.id], gatedChannelIds: [...new Set([...(state.gatedChannelIds ?? []), ...(config.managedGates ?? []), ...newlyGated])] });
      await this.rulesService.preview(guild, interaction.user.id);
      await this.rulesService.setup(guild, interaction.user.id);
      const rules = await this.rulesService.store.get(guild.id);
      config.channels['📜・rules'] = rules.rulesChannelId;
      config.welcomeEnabled = true; config.xpEnabled = true; config.antiSpamEnabled = true;
      save();
      await this.panels(guild, config);
      config.complete = true; save();
    }
    return { content: `${scope} setup completed. Saved resources will be reused. Use /setup-status to inspect configuration. Streaming still needs explicit provider configuration and credentials.` };
  }
  async status(guild) {
    const config = configFor(this.store, guild.id);
    const roles = await guild.roles.fetch(); const channels = await guild.channels.fetch();
    const missing = [...Object.values(config.roles ?? {}).filter((id) => !roles.has(id)), ...Object.values(config.channels ?? {}).filter((id) => !channels.has(id))];
    return { content: `**VOIDTIDE status**\nRoles: ${Object.keys(config.roles ?? {}).length}; channels: ${Object.keys(config.channels ?? {}).length}.\nFull setup: ${config.complete ? 'completed' : 'incomplete'}; missing saved resources: ${missing.length}.\nWelcome: ${Boolean(config.welcomeEnabled)}; XP: ${Boolean(config.xpEnabled)}; anti-spam: ${Boolean(config.antiSpamEnabled)}.\nRules, tickets, XP, moderation, polls and jobs use persistent storage. Streaming accounts: ${this.store.list(guild.id, 'streams').length}. Continuous notifications require this process to stay running. No tokens are shown.` };
  }
}
