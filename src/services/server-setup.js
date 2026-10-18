import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { Buffer } from 'node:buffer';
import { ROLE_DEFINITIONS, LAYOUT, CATEGORY_KEYS, CHANNEL_KEYS, READONLY, SELF_ROLES, STAFF_ROLES, staffRoleIds } from '../config/server-layout.js';
import { configFor, digest, requirePermission, UserError } from './management-utils.js';

export const BOT_PERMISSIONS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory,
  P.ManageChannels, P.ManageRoles, P.ManageMessages, P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageEvents];
const setupPermissions = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles];
const posting = [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads];
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function candidate(collection, id, name, type, alias) {
  const saved = id && collection.get(id);
  const matches = [...collection.values()].filter((item) => same(item.name, name)
    && (type === undefined || (item.type === ChannelType.GuildCategory) === (type === ChannelType.GuildCategory)));
  if (matches.length > 1 || (saved && matches.some((item) => item.id !== saved.id))) throw new UserError(`Duplicate candidates for ${name}. Resolve the ambiguity manually; setup never deletes resources.`);
  let item = saved || matches[0];
  if (!item && alias) {
    const old = [...collection.values()].filter((item) => same(item.name, alias)
      && (type === undefined || (item.type === ChannelType.GuildCategory) === (type === ChannelType.GuildCategory)));
    if (old.length > 1) throw new UserError(`Duplicate candidates for ${alias}. Review them manually.`);
    item = old[0];
  }
  const compatibleAnnouncement = name === '📢・announcements' && type === ChannelType.GuildText && item?.type === ChannelType.GuildAnnouncement;
  if (item && type !== undefined && item.type !== type && !compatibleAnnouncement) throw new UserError(`The existing ${name} (<#${item.id}>) is ${ChannelType[item.type]}; expected ${ChannelType[type]}. Review the resource and saved configuration. Setup will not convert or delete it.`);
  return item;
}

export class ServerSetup {
  constructor(services) { Object.assign(this, services); this.previews = new Map(); }
  async inspect(guild, scope) {
    const roles = await guild.roles.fetch(); const channels = await guild.channels.fetch();
    const me = await guild.members.fetchMe({ force: true });
    if (!me.permissions.has(setupPermissions)) throw new UserError('The bot needs View/Send/Embed/Attach/History and Manage Channels/Roles for setup. No Administrator is needed.');
    if (guild.roles.everyone.permissions.has([P.Administrator], false) || [P.ManageChannels, P.ManageRoles].some((p) => guild.roles.everyone.permissions.has(p, false))) throw new UserError('Ask staff to remove Administrator, Manage Channels and Manage Roles from @everyone before setup. Existing permissions will not be edited automatically.');
    const config = configFor(this.store, guild.id); const legacy = await this.rulesService.store.get(guild.id) ?? {};
    const plannedRoles = ROLE_DEFINITIONS.map(([name, permissions]) => {
      const role = candidate(roles, name === 'Verified' ? legacy.verifiedRoleId ?? config.roles?.Verified : config.roles?.[name], name);
      if (name === 'Verified' && legacy.verifiedRoleId && !roles.has(legacy.verifiedRoleId) && legacy.gatedChannelIds?.length) throw new UserError('Recover the deleted Verified mapping from the rules recovery guide before setup.');
      if (role && (role.managed || !role.editable || me.roles.highest.comparePositionTo(role) <= 0 || role.permissions.bitfield !== 0n)) throw new UserError(`Existing role ${name} has incompatible permissions or hierarchy. Staff must review it; setup never overwrites permissions.`);
      if (role && SELF_ROLES.some((r) => r.name === name) && [...channels.values()].some((c) => (c.permissionOverwrites?.cache.get(role.id)?.allow.bitfield ?? 0n) !== 0n)) throw new UserError(`Self-selectable role ${name} has channel permission grants. Staff must remove those grants before setup.`);
      return { name, permissions, role };
    });
    const staffIds = staffRoleIds(roles, guild.id); const plannedChannels = []; const notes = [];
    if (scope !== 'roles') for (const [group, names] of LAYOUT) {
      const key = CATEGORY_KEYS[group];
      const parent = candidate(channels, config.categories?.[group] ?? config.categories?.[key], group, ChannelType.GuildCategory, key);
      plannedChannels.push({ name: group, key, category: group, type: ChannelType.GuildCategory, channel: parent, staff: key === 'STAFF' });
      for (const name of names) {
        const key = CHANNEL_KEYS[name]; const type = CATEGORY_KEYS[group] === 'VOICE' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const saved = key === '📜・rules' ? legacy.rulesChannelId ?? config.channels?.[key] : config.channels?.[key];
        const oldPanel = key === 'choose-roles' && saved && channels.get(saved);
        const keepPrivatePanel = oldPanel && !same(oldPanel.name, name) && !oldPanel.permissionsFor(guild.roles.everyone)?.has([P.ViewChannel, P.ReadMessageHistory]);
        let channel = candidate(channels, keepPrivatePanel ? undefined : saved, name, type, keepPrivatePanel ? undefined : key);
        if (keepPrivatePanel) notes.push(`Keep private legacy role channel ${oldPanel.id} untouched; use/create the public ${name} channel.`);
        if (key === 'choose-roles' && channel && !channel.permissionsFor(guild.roles.everyone)?.has([P.ViewChannel, P.ReadMessageHistory])) {
          if (same(channel.name, name)) throw new UserError(`The existing <#${channel.id}> role panel channel is not public. Staff must review its View Channel/Read History permissions; setup will not change them.`);
          notes.push(`Keep private legacy role channel ${channel.id} untouched; create the new public ${name} channel.`);
          channel = undefined;
        }
        plannedChannels.push({ name, key, category: group, type, channel, staff: CATEGORY_KEYS[group] === 'STAFF' });
      }
    }
    const claimed = new Set();
    for (const item of plannedChannels) if (item.channel) {
      const channel = item.channel;
      if (claimed.has(channel.id)) throw new UserError('One saved channel is mapped to multiple layout resources. Review the saved IDs.');
      claimed.add(channel.id);
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) throw new UserError(`The bot cannot safely manage ${item.name}. Staff must review its permissions.`);
      if (item.staff) {
        const verified = plannedRoles.find((r) => r.name === 'Verified')?.role;
        if (channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel) || (verified && channel.permissionsFor(verified).has(P.ViewChannel))) throw new UserError(`Existing staff resource ${item.name} is public or visible to Verified. Staff must make it private manually; no permissions were changed.`);
        for (const o of channel.permissionOverwrites.cache.values()) if (o.allow.has(P.ViewChannel, false) && ![guild.ownerId, me.id, ...staffIds].includes(o.id)) throw new UserError(`Existing staff resource ${item.name} has an unrelated visibility grant. Staff must review it; no permissions were changed.`);
      }
    }
    const fingerprint = digest({ scope, config, legacy, roles: [...roles.values()].map((r) => [r.id, r.name, r.position, r.permissions.bitfield.toString()]).sort(),
      channels: [...channels.values()].map((c) => [c.id, c.name, c.type, c.parentId, [...(c.permissionOverwrites?.cache.values() ?? [])].map((o) => [o.id, o.type, o.allow.bitfield.toString(), o.deny.bitfield.toString()]).sort()]).sort() });
    return { config, legacy, me, roles, plannedRoles, plannedChannels, staffIds, notes, fingerprint };
  }
  async run(interaction, scope = 'server', commandName = `setup-${scope}`) {
    requirePermission(interaction);
    if (['badr', 'yacin', 'nisrine', 'mehdi'].some((name) => interaction.options.getUser?.(name))) throw new UserError('Automatic staff assignments were removed. Staff must manage privileged roles manually.');
    if (interaction.options.getBoolean('delete_conflicts') === true) throw new UserError('Channel deletion was removed. Setup only creates, renames or organizes reviewed resources. Existing permissions stay unchanged.');
    return this.store.lock(`setup:${interaction.guildId}`, async () => {
      const plan = await this.inspect(interaction.guild, scope);
      const key = `${interaction.guildId}:${interaction.user.id}:${commandName}`;
      if (interaction.options.getBoolean('confirm') !== true) {
        this.previews.set(key, { hash: plan.fingerprint, expires: Date.now() + 600_000 });
        const detail = { scope, expiresInMinutes: 10, automaticDeletion: false, existingPermissionsChanged: false, privilegedRolesAssigned: false,
          roles: plan.plannedRoles.map((r) => ({ name: r.name, id: r.role?.id ?? null, action: r.role ? 'reuse unchanged' : 'create', permissions: [] })),
          channels: plan.plannedChannels.map((c) => ({ name: c.name, id: c.channel?.id ?? null, currentName: c.channel?.name ?? null, category: c.category, type: c.type,
            action: c.channel ? 'reuse; rename/move if needed, preserve permission overwrites' : 'create', staffOnly: c.staff })),
          newPermissions: { public: ['ViewChannel', 'ReadMessageHistory'], readOnlyPostingDenied: posting.map((bit) => Object.keys(P).find((name) => P[name] === bit)),
            botAllows: setupPermissions.map((bit) => Object.keys(P).find((name) => P[name] === bit)), staff: { everyoneView: false, allowedRoleIds: plan.staffIds, memberRoleGrants: [] } },
          notes: plan.notes, messages: scope === 'server' ? 'Publish/update role and ticket panels; refresh the existing rules panel to Agree only. Keep existing verification gates, XP/tickets/announcements/moderation data and destinations.' : 'Resource setup only.',
          welcomeChannelsCreated: false, goodbyeChannelsCreated: false, staffRoleAssignments: [] };
        return { files: [{ attachment: Buffer.from(JSON.stringify(detail, null, 2)), name: 'voidtide-setup-preview.json' }], content:
          `**VOIDTIDE ${scope} setup preview**\nCreate ${plan.plannedChannels.filter((c) => !c.channel).length} missing categories/channels and ${plan.plannedRoles.filter((r) => !r.role).length} nonprivileged roles. Existing resources may be renamed/moved as listed; their permission overwrites stay unchanged.\nNo channels are deleted. No staff roles are created or assigned. No welcome/goodbye channels are created; automatic welcome messages are disabled. New STAFF resources are private.\n${plan.notes.join('\n')}\nRead the complete attached plan, including permissions for new resources and panel updates. Confirm as the same administrator within ten minutes: **/${commandName} confirm:true**.` };
      }
      const review = this.previews.get(key);
      if (!review || review.expires <= Date.now() || review.hash !== plan.fingerprint) throw new UserError('Run a fresh setup preview as the same administrator before confirming; roles, channels or settings may have changed.');
      this.previews.delete(key);
      return this.apply(interaction, scope, plan);
    });
  }
  async apply(interaction, scope, plan) {
    const guild = interaction.guild; const reason = `VOIDTIDE simple setup confirmed by ${interaction.user.id}`;
    const config = { ...plan.config, roles: { ...plan.config.roles }, channels: { ...plan.config.channels }, categories: { ...plan.config.categories }, staffRoleIds: plan.staffIds };
    const save = () => this.store.set(guild.id, 'config', 'server', config);
    if (scope === 'server') { config.complete = false; save(); }
    for (const item of plan.plannedRoles) {
      const role = item.role ?? await guild.roles.create({ name: item.name, permissions: [], reason });
      config.roles[item.name] = role.id; save();
    }
    for (const name of STAFF_ROLES) {
      const role = [...plan.roles.values()].find((r) => same(r.name, name) && plan.staffIds.includes(r.id));
      if (role) config.roles[name] = role.id;
    }
    for (const item of plan.plannedChannels) {
      let channel = item.channel;
      if (!channel) {
        const overwrites = [
          { id: guild.id, ...(item.staff ? { deny: [P.ViewChannel] } : { allow: [P.ViewChannel, P.ReadMessageHistory] }), ...(!item.staff && READONLY.has(item.key) ? { deny: posting } : {}) },
          { id: plan.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageChannels, P.ManageRoles] },
          ...(item.staff ? plan.staffIds.map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })) : []),
        ];
        channel = await guild.channels.create({ name: item.name, type: item.type,
          ...(item.type !== ChannelType.GuildCategory ? { parent: config.categories[item.category] } : {}), permissionOverwrites: overwrites, reason,
          ...(item.key === 'gaming-chat' ? { topic: 'Gaming and text-first community chat. Deaf, hard-of-hearing and hearing members are welcome; keep important information available in writing.' } : {}) });
      } else {
        if (channel.name !== item.name) await channel.setName(item.name, reason);
        if (item.type !== ChannelType.GuildCategory && channel.parentId !== config.categories[item.category]) await channel.setParent(config.categories[item.category], { lockPermissions: false, reason });
      }
      if (item.type === ChannelType.GuildCategory) { config.categories[item.name] = channel.id; config.categories[item.key] = channel.id; }
      else { config.channels[item.name] = channel.id; config.channels[item.key] = channel.id; }
      save();
    }
    config.rolesReady = true; config.welcomeEnabled = false; config.simpleLayout = true;
    if (scope !== 'roles') config.channelsReady = true;
    for (const [key, fallback] of Object.entries({ general: 'gaming-chat', events: 'gaming-chat', 'level-rewards': 'leaderboard', 'mod-logs': 'bot-logs', 'ticket-logs': 'bot-logs' })) {
      if (!config.channels[key] || !guild.channels.cache.has(config.channels[key])) config.channels[key] = config.channels[fallback];
    }
    // Preserve existing service destinations and all persistent records.
    config.xpEnabled ??= true; config.antiSpamEnabled ??= true; save();
    if (scope === 'server') {
      const state = await this.rulesService.store.get(guild.id) ?? {};
      await this.rulesService.store.set(guild.id, { verifiedRoleId: config.roles.Verified, rulesChannelId: config.channels['📜・rules'], preserveChannelPermissions: true,
        publicChannelIds: [...new Set([...(state.publicChannelIds ?? []), config.channels['choose-roles']])] });
      await this.rulesService.preview(guild, interaction.user.id, { layout: state.rulesLayout ?? 'split' });
      await this.rulesService.setup(guild, interaction.user.id);
      await this.panels(guild, config);
      config.complete = true; save();
    }
    return { content: 'VOIDTIDE setup completed. Existing permission overwrites and service data were preserved; no channels were deleted and no privileged roles were assigned. No welcome/goodbye channels were created. Use /setup-status to check the configuration.' };
  }
  async status(guild) {
    const config = configFor(this.store, guild.id); const channels = await guild.channels.fetch();
    const missing = [...new Set(Object.values(config.channels ?? {}))].filter((id) => !channels.has(id));
    return { content: `**VOIDTIDE status**\nSimple layout: ${Boolean(config.simpleLayout)}; setup completed: ${Boolean(config.complete)}; missing channel IDs: ${missing.length}.\nWelcome/goodbye: ${config.welcomeEnabled ? 'enabled manually' : 'disabled'}. XP: ${Boolean(config.xpEnabled)}; anti-spam: ${Boolean(config.antiSpamEnabled)}.\nFive nonprivileged role choices; existing rules, tickets, announcements and moderation remain available. No secrets are shown.` };
  }
}
