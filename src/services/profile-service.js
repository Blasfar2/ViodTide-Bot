import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P, StringSelectMenuBuilder } from 'discord.js';
import { PROFILE_GROUPS, PROFILE_LAYOUT, PANEL_KEYS, PANEL_CHANNELS, forbiddenRoleName } from '../config/profile.js';
import { configFor, digest, embed, safeRole, sendOnce, textChannel, UserError } from './management-utils.js';

const publicPermissions = [P.ViewChannel, P.ReadMessageHistory];
const botPermissions = [...publicPermissions, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageChannels, P.ManageRoles];
const posting = [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads];
const normalized = (name) => name.normalize('NFKC').toLowerCase();
const roleKey = (group, choice) => `${group}:${choice.key}`;

/** Public panel state contains resource IDs, never a member's country or location. */
export class ProfileService {
  constructor({ store, rulesService }) { Object.assign(this, { store, rulesService }); }
  roleId(config, group, choice) {
    return config.profile?.roles?.[roleKey(group, choice)] ?? (group === 'community' ? config.roles?.[choice.name] : undefined);
  }
  async approvedRole(guild, config, group, choice, snapshot) {
    const id = this.roleId(config, group, choice);
    if (id && id === config.roles?.Verified) throw new UserError('Verification roles cannot be assigned through public profile panels.');
    const role = await safeRole(guild, id, snapshot);
    if (forbiddenRoleName(role.name)) throw new UserError('Staff and bot roles cannot be assigned through public panels.');
    return role;
  }
  async snapshot(guild) {
    const [roles, channels, me] = await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetchMe({ force: true })]);
    const config = configFor(this.store, guild.id);
    const hash = digest({ config, socialSettings: this.store.list(guild.id, 'social-settings'), me: me.permissions.bitfield.toString(), highest: me.roles.highest.id,
      roles: [...roles.values()].map((r) => [r.id, r.name, r.position, r.managed, r.permissions.bitfield.toString()]).sort(),
      channels: [...channels.values()].map((c) => [c.id, c.name, c.type, c.parentId, [...(c.permissionOverwrites?.cache.values() ?? [])].map((o) => [o.id, o.type, o.allow.bitfield.toString(), o.deny.bitfield.toString()]).sort()]).sort() });
    return { roles, channels, me, config, hash };
  }
  async inspect(guild) {
    const state = await this.snapshot(guild); const { roles, channels, me, config } = state;
    if (!me.permissions.has([P.ManageRoles, P.ManageChannels])) throw new UserError('The bot needs Manage Roles and Manage Channels to set up profile panels.');
    if (guild.roles.everyone.permissions.any([P.Administrator, P.ManageChannels, P.ManageRoles])) throw new UserError('Staff must first remove channel/role management privileges from @everyone. No permissions were changed.');
    const plannedRoles = []; const used = new Set();
    for (const [group, choices] of Object.entries(PROFILE_GROUPS)) for (const choice of choices) {
      const id = this.roleId(config, group, choice);
      const aliases = new Set([choice.name, choice.label, `${choice.emoji} ${choice.name}`].filter(Boolean).map(normalized));
      const matches = [...roles.values()].filter((r) => aliases.has(normalized(r.name)));
      let role = id ? roles.get(id) : null;
      if (!role && matches.length > 1) throw new UserError(`Multiple ${choice.name} roles exist. Staff must resolve the ambiguity first.`);
      role ??= matches[0];
      if (role && matches.some((r) => r.id !== role.id)) throw new UserError(`A duplicate ${choice.name} role needs staff review.`);
      if (role) {
        await this.approvedRole(guild, { roles: config.roles, profile: { roles: { [roleKey(group, choice)]: role.id } } }, group, choice, state);
        if (used.has(role.id)) throw new UserError('Two profile choices reference the same role. Staff must review configuration.');
        used.add(role.id);
      }
      plannedRoles.push({ group, key: roleKey(group, choice), name: choice.name, id: role?.id ?? null });
    }
    const plannedChannels = []; const channelIds = new Set();
    for (const [category, children] of PROFILE_LAYOUT) {
      for (const [key, name, type] of [[category, category, ChannelType.GuildCategory], ...children.map(([key, name]) => [key, name, ChannelType.GuildText])]) {
        const saved = type === ChannelType.GuildCategory ? config.profile?.categories?.[key] : config.channels?.[key];
        const matches = [...channels.values()].filter((c) => normalized(c.name) === normalized(name));
        let channel = saved ? channels.get(saved) : null;
        if (!channel && matches.length > 1) throw new UserError(`Multiple ${name} channels exist. Staff must resolve them first.`);
        channel ??= matches[0];
        if (channel && matches.some((c) => c.id !== channel.id)) throw new UserError(`A duplicate ${name} channel needs staff review.`);
        if (channel && channel.type !== type && !(key === 'live-now' && channel.type === ChannelType.GuildAnnouncement)) throw new UserError(`The existing ${name} has the wrong type. Staff must review it; nothing will be deleted.`);
        if (channel) {
          if (channelIds.has(channel.id)) throw new UserError('Two profile resources reference the same channel. Staff must review configuration.');
          channelIds.add(channel.id);
          if (!channel.permissionsFor(guild.roles.everyone)?.has(publicPermissions)) throw new UserError(`${name} must be public before it can be reused. Staff must review access manually; existing permissions stay unchanged.`);
          if (channel.permissionsFor(guild.roles.everyone)?.any([P.Administrator, P.ManageChannels, P.ManageRoles])) throw new UserError(`${name} gives channel/role management permissions to everyone. Staff must review access manually.`);
          if (!channel.permissionsFor(me)?.has(type === ChannelType.GuildCategory ? [P.ViewChannel, P.ManageChannels] : botPermissions)) throw new UserError(`The bot lacks required access to ${name}. Existing permissions stay unchanged.`);
        }
        plannedChannels.push({ key, name, type, category, id: channel?.id ?? null, currentName: channel?.name ?? null, currentParent: channel?.parentId ?? null });
      }
    }
    return { ...state, plannedRoles, plannedChannels };
  }
  async setup(guild, plan, actorId) {
    const reason = `VOIDTIDE profile setup confirmed by ${actorId}`;
    const config = configFor(this.store, guild.id);
    config.roles ??= {}; config.channels ??= {}; config.profile ??= {};
    config.profile.roles ??= {}; config.profile.categories ??= {};
    const save = () => this.store.set(guild.id, 'config', 'server', config);
    for (const item of plan.plannedRoles) {
      const role = item.id ? await guild.roles.fetch(item.id, { force: true }) : await guild.roles.create({ name: item.name, permissions: [], mentionable: false, reason });
      if (!role) throw new UserError('A reviewed role disappeared. Run a fresh setup preview.');
      config.profile.roles[item.key] = role.id;
      if (item.group === 'community') config.roles[item.name] = role.id;
      save();
    }
    for (const item of plan.plannedChannels) {
      let channel = item.id ? await guild.channels.fetch(item.id, { force: true }) : null;
      const categoryId = config.profile.categories[item.category];
      if (!channel) {
        channel = await guild.channels.create({ name: item.name, type: item.type,
          ...(item.type === ChannelType.GuildCategory ? {} : { parent: categoryId }),
          permissionOverwrites: [{ id: guild.id, allow: publicPermissions, deny: posting }, { id: plan.me.id, allow: botPermissions }], reason });
      } else {
        if (channel.name !== item.name) await channel.setName(item.name, reason);
        if (item.type !== ChannelType.GuildCategory && channel.parentId !== categoryId) await channel.setParent(categoryId, { lockPermissions: false, reason });
      }
      if (item.type === ChannelType.GuildCategory) config.profile.categories[item.key] = channel.id;
      else config.channels[item.key] = channel.id;
      save();
    }
    config.profile.ready = true; config.profile.countryEnabled ??= true; save();
    await this.publish(guild);
    return { content: '🌌 VOIDTIDE profile panels are ready. Community, notification and optional country roles are available. Existing permissions and service records were preserved.' };
  }
  async presentation(guild, panel) {
    const state = await this.rulesService.store.get(guild.id);
    if (!state?.rulesLogo) return { embeds: [panel], attachments: [] };
    const file = await this.rulesService.logos.load(guild.id, state.rulesLogo);
    const me = await guild.members.fetchMe({ force: true });
    if (!me.permissions.has(P.AttachFiles)) throw new UserError('The configured VOIDTIDE logo needs Attach Files.');
    return { embeds: [panel.setThumbnail(`attachment://${file.name}`)], files: [file], attachments: [] };
  }
  async publish(guild) {
    const snapshot = await this.snapshot(guild); const config = snapshot.config;
    if (!config.profile?.ready) throw new UserError('Use /manage-server → Setup Panels first.');
    for (const [group, choices] of Object.entries(PROFILE_GROUPS)) {
      const channel = await textChannel(guild, config.channels[PANEL_CHANNELS[group]], botPermissions);
      if (!channel.permissionsFor(guild.roles.everyone)?.has(publicPermissions)) throw new UserError('Profile panels must stay publicly readable. Staff must review access manually.');
      for (const choice of choices) await this.approvedRole(guild, config, group, choice, snapshot);
      let panel; let components;
      if (group === 'community') {
        panel = embed('🌌 VOIDTIDE | Choose Your Roles', '**YOUR COMMUNITY. YOUR STYLE.**\n\n🎮 **Gamer** · Find your next squad\n🔴 **Live Notification** · Show your interest in live alerts\n🎬 **Video Notification** · Show your interest in videos\n🤟 **Sign Language** · Celebrate accessible communication\n🏆 **Events** · Join the community action\n\n**Tap to add. Tap again to remove.**\nFor platform alerts, choose your subscriptions in the notification panel. These roles grant no staff privileges.').setColor(0x8b5cf6);
        components = [new ActionRowBuilder().addComponents(choices.map((choice) => new ButtonBuilder().setCustomId(`voidtide:role:${choice.key}`).setLabel(choice.name).setEmoji(choice.emoji).setStyle(ButtonStyle.Secondary)))];
        const legacy = this.store.get(guild.id, 'deliveries', 'panel:roles');
        if (!this.store.get(guild.id, 'deliveries', PANEL_KEYS.community) && legacy?.channelId === channel.id) this.store.set(guild.id, 'deliveries', PANEL_KEYS.community, legacy);
      } else {
        const country = group === 'country';
        panel = embed(country ? '🌍 VOIDTIDE | Where Are You From?' : '🔔 VOIDTIDE | Pick Your Notification Roles',
          country ? 'Choose your country and receive a country flag role! Participation is optional.\n\nSelect one country below, or clear your choice anytime. Your flag role is visible to other members. We do not collect your address or precise location.'
            : 'Never miss our latest streams, videos, reels, and community updates! Select which notifications you want to receive.\n\n**Choose all platforms you want to keep.** Submitting replaces your previous choices. Clear all to opt out.\nThese are Discord roles only; they never subscribe you to external services. Alerts depend on configured integrations.').setColor(country ? 0x8b5cf6 : 0x22d3ee);
        const menu = new StringSelectMenuBuilder().setCustomId(`voidtide:profile:${group}:v1`).setPlaceholder(country ? 'Choose one country · optional' : 'Choose your platforms · multiple allowed')
          .setMinValues(0).setMaxValues(country ? 1 : choices.length).setDisabled(country && config.profile.countryEnabled === false)
          .addOptions(choices.map((choice) => ({ label: choice.label ?? choice.name, value: choice.key, ...(choice.emoji === '𝕏' ? {} : { emoji: choice.emoji }) })));
        components = [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`voidtide:profile:clear-${group}:v1`).setLabel(country ? 'Remove my country role' : 'Remove all notification roles').setEmoji(country ? '🌍' : '🔕').setStyle(ButtonStyle.Secondary))];
      }
      await sendOnce(this.store, channel, PANEL_KEYS[group], { ...await this.presentation(guild, panel), components }, { edit: true });
    }
  }
  async select(interaction, group, values) {
    if (!['social', 'country'].includes(group) || !Array.isArray(values)) throw new UserError('Use the current VOIDTIDE profile panel.');
    return this.store.lock(`role:${interaction.guildId}:${interaction.user.id}`, async () => {
      const config = configFor(this.store, interaction.guildId); const choices = PROFILE_GROUPS[group];
      const saved = this.store.get(interaction.guildId, 'deliveries', PANEL_KEYS[group]);
      if (!config.profile?.ready || saved?.channelId !== interaction.channelId || saved?.messageId !== interaction.message?.id) throw new UserError('Use the current VOIDTIDE profile panel.');
      if (new Set(values).size !== values.length || values.some((key) => !choices.some((c) => c.key === key)) || values.length > (group === 'country' ? 1 : choices.length)) throw new UserError('Choose only the options in the current panel.');
      if (group === 'country' && config.profile.countryEnabled === false && values.length) throw new UserError('Country selection is currently disabled. You can still remove your country role.');
      const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
      if (member.user.bot || member.pending) throw new UserError('Complete Discord membership screening before selecting community roles.');
      // Validate the entire group before making any changes. Never use a submitted Discord role ID.
      const roles = []; const snapshot = await this.snapshot(interaction.guild);
      for (const choice of choices) roles.push({ choice, role: await this.approvedRole(interaction.guild, config, group, choice, snapshot) });
      const before = roles.filter(({ role }) => member.roles.cache.has(role.id));
      const removed = []; const added = [];
      try {
        for (const item of before.filter(({ choice }) => !values.includes(choice.key))) {
          await member.roles.remove(item.role, 'Member updated optional VOIDTIDE profile roles'); removed.push(item);
        }
        for (const item of roles.filter(({ choice, role }) => values.includes(choice.key) && !member.roles.cache.has(role.id))) {
          await member.roles.add(item.role, 'Member selected an approved VOIDTIDE profile role'); added.push(item);
        }
      } catch (error) {
        // Restore the original group when Discord rejects a partial update. Never touch other roles.
        try {
          for (const item of added) { await this.approvedRole(interaction.guild, config, group, item.choice); await member.roles.remove(item.role); }
          for (const item of removed) { await this.approvedRole(interaction.guild, config, group, item.choice); await member.roles.add(item.role); }
        } catch { throw new UserError('Discord interrupted your role update and recovery. Ask staff to review your roles, then retry.'); }
        throw error;
      }
      return { content: group === 'country' ? (values.length ? '🌍 Your country role was updated. You can change or remove it anytime.' : '🌍 Your country role was removed.')
        : `🔔 Notification choices saved: ${values.length ? roles.filter(({ choice }) => values.includes(choice.key)).map(({ choice }) => choice.name).join(', ') : 'none'}. No external subscriptions were created.` };
    });
  }
}
