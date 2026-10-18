import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits as P, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { COUNTRY_ROLES, SOCIAL_ROLES, forbiddenRoleName } from '../config/profile.js';
import { configFor, embed, requirePermission, safeRole, UserError } from './management-utils.js';

const button = (key, label, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`voidtide:manage:${key}`).setLabel(label).setEmoji(emoji).setStyle(style);
const row = (...components) => new ActionRowBuilder().addComponents(components);
const field = (key, label, required = true, max = 100, value) => {
  const input = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (value !== undefined && value !== null) input.setValue(String(value));
  return row(input);
};

export class ProfileAdmin {
  constructor({ store, profiles, notifications }) { Object.assign(this, { store, profiles, notifications }); }
  async authorize(interaction) {
    requirePermission(interaction);
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    if (!member.permissions.has(P.Administrator)) throw new UserError('Only current server administrators can manage VOIDTIDE configuration.');
  }
  dashboard() {
    return { embeds: [embed('🌌 VOIDTIDE | Server Management', '**Shape your community. Keep it simple.**\n\nManage names, choose opt-in alerts, and publish your profile panels. Every change has a private preview with **Confirm** and **Cancel**.\nExisting channel permissions stay unchanged. No channels, messages or roles are deleted.').setColor(0x8b5cf6)], components: [
      row(button('channels', 'Manage Channels', '📁'), button('roles', 'Manage Roles', '🎭')),
      row(button('notifications', 'Notification Settings', '🔔'), button('countries', 'Country Roles', '🌍')),
      row(button('setup', 'Setup Panels', '⚙️', ButtonStyle.Primary), button('refresh', 'Refresh Panels', '🔄')),
    ] };
  }
  async review(interaction, action) {
    await this.authorize(interaction);
    const plan = action.type === 'setup' ? await this.profiles.inspect(interaction.guild) : await this.profiles.snapshot(interaction.guild);
    if (action.type === 'create-channel' || (action.type === 'rename-channel' && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(plan.channels.get(action.id)?.type))) action = { ...action, name: action.name.normalize('NFKC').toLowerCase().replace(/\s+/gu, '-') };
    if (action.type === 'rename-channel') {
      const channel = plan.channels.get(action.id);
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement].includes(channel.type) || !channel.permissionsFor(plan.me)?.has(P.ManageChannels)) throw new UserError('Choose an existing channel/category the bot can manage.');
    }
    if (action.type === 'create-channel' && !plan.me.permissions.has(P.ManageChannels)) throw new UserError('The bot needs Manage Channels.');
    if (['create-channel', 'rename-channel'].includes(action.type)) {
      const equivalent = (name) => name.normalize('NFKC').toLowerCase().replace(/\s+/gu, '-');
      if ([...plan.channels.values()].some((c) => c.id !== action.id && equivalent(c.name) === equivalent(action.name))) throw new UserError('That channel/category name already exists. Choose the existing resource instead.');
      if (/welcome|goodbye/iu.test(action.name)) throw new UserError('This setup does not create or rename welcome/goodbye channels.');
    }
    if (action.type === 'rename-role') {
      const role = await safeRole(interaction.guild, action.id);
      if (forbiddenRoleName(role.name)) throw new UserError('Manage staff and bot roles manually in Discord.');
    }
    if (['create-role', 'rename-role'].includes(action.type)) {
      if (!plan.me.permissions.has(P.ManageRoles) || forbiddenRoleName(action.name)) throw new UserError('Use a nonprivileged community role name. The bot needs Manage Roles.');
      if ([...plan.roles.values()].some((r) => r.id !== action.id && r.name.toLowerCase() === action.name.toLowerCase())) throw new UserError('That role name already exists. Choose the existing role instead.');
    }
    if (action.type === 'notification') await this.notifications.validateSettings(interaction.guild, action.platform, action.settings);
    if (action.type === 'refresh' && !plan.config.profile?.ready) throw new UserError('Use Setup Panels before refreshing them.');
    if (action.type === 'country' && !plan.config.profile?.ready) throw new UserError('Use Setup Panels before changing country settings.');
    const token = randomUUID();
    for (const { key, value } of this.store.list(interaction.guildId, 'admin-reviews')) if (value.expires <= Date.now()) this.store.delete(interaction.guildId, 'admin-reviews', key);
    this.store.set(interaction.guildId, 'admin-reviews', token, { action, actorId: interaction.user.id, expires: Date.now() + 600_000, hash: plan.hash, status: 'pending' });
    const detail = action.type === 'setup' ? { action: 'setup-profile-panels', roles: plan.plannedRoles, channels: plan.plannedChannels,
      existingPermissionsChanged: false, deletion: false, privilegedAssignments: false,
      newChannelPermissions: { everyone: { allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages', 'AddReactions', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] }, bot: ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageChannels', 'ManageRoles'] },
      notifications: { enabledByDefault: true, cooldownMinutes: 5, mentions: 'Only the platform opt-in role; never @everyone/@here. Existing explicit social settings are retained.', destinations: 'Twitch → live-now; YouTube → social-youtube. Configure overrides via Notification Settings. Existing stream account records are preserved.', permissions: 'Role ping delivery requires the bot to have Mention Everyone in the destination channel, or the opt-in role to be mentionable. Neither permission is changed automatically.', integrations: 'Only Twitch and YouTube have API adapters; credentials and /stream-config accounts are required. TikTok, Instagram and X are settings-only.' },
      panelMessages: 'Publish or edit the three persistent role panels. Reuse the existing community panel; keep all other features and messages.' } : action;
    let description;
    if (action.type === 'setup') description = `Create **${plan.plannedRoles.filter((r) => !r.id).length}** missing nonprivileged roles and **${plan.plannedChannels.filter((c) => !c.id).length}** categories/channels. Reuse, rename or move the exact resources in the attached plan; existing permission overwrites stay unchanged. Publish three role panels.\n\nTwitch/YouTube alerts will use platform opt-in roles and the reviewed social destinations, with a five-minute platform cooldown by default. Credentials, accounts and manual bot ping permission are required; see the attachment. Existing explicit social settings are retained.`;
    else if (action.type === 'refresh') description = 'Edit the three saved panel messages in place. Recreate a deleted panel message if necessary. Reuse current roles, channel names and permissions.';
    else if (action.type === 'notification') description = `${action.platform}: **${action.settings.enabled ? 'enabled' : 'disabled'}**, channel <#${action.settings.channelId}>, minimum **${action.settings.cooldownMinutes} minutes** between platform pings. Only the platform’s approved opt-in role can be mentioned. ${SOCIAL_ROLES.find((r) => r.key === action.platform).automatic ? 'Requires provider credentials and a configured account.' : 'Automatic delivery is unavailable in this bot. Settings are saved for a future compliant integration; no scraper or external subscription is created.'}`;
    else if (action.type === 'country') description = `Country selections will be **${action.enabled ? 'enabled' : 'disabled'}**. Members can still clear their own country role. Existing member roles stay unchanged.`;
    else description = `${action.type.startsWith('rename') ? `Rename resource **${action.id}**` : 'Create a nonprivileged resource'} to **${action.name}**. ${action.type === 'create-channel' ? 'New text channel: @everyone View/Read allowed, posting denied; bot View/Read/Send/Embed/Attach/Manage Channels allowed. No existing permissions change.' : 'No permission changes, member assignments or deletions.'}`;
    return { embeds: [embed('🌌 VOIDTIDE | Confirm Changes', `${description}\n\nReview the attachment. Only you can confirm or cancel this preview, within **10 minutes**. A server/configuration change invalidates it.`).setColor(0x22d3ee)],
      files: [{ attachment: Buffer.from(JSON.stringify(detail, null, 2)), name: 'voidtide-profile-preview.json' }],
      components: [row(button(`confirm:${token}`, 'Confirm', '✅', ButtonStyle.Success), button(`cancel:${token}`, 'Cancel', '✖️'))] };
  }
  async confirm(interaction, token, cancel = false) {
    return this.store.lock(`profile-admin:${interaction.guildId}`, async () => {
      await this.authorize(interaction);
      const saved = this.store.get(interaction.guildId, 'admin-reviews', token);
      if (!saved || saved.actorId !== interaction.user.id || saved.status !== 'pending' || saved.expires <= Date.now()) throw new UserError('This preview expired, belongs to another administrator, or was already used. Open a fresh preview.');
      if (cancel) { this.store.delete(interaction.guildId, 'admin-reviews', token); return { content: 'Changes cancelled. Nothing was changed.' }; }
      const plan = saved.action.type === 'setup' ? await this.profiles.inspect(interaction.guild) : await this.profiles.snapshot(interaction.guild);
      if (plan.hash !== saved.hash) throw new UserError('Server resources or settings changed. Open and review a fresh preview.');
      this.store.set(interaction.guildId, 'admin-reviews', token, { ...saved, status: 'applying' });
      const action = saved.action; const guild = interaction.guild; const reason = `VOIDTIDE management confirmed by ${interaction.user.id}`;
      try {
        if (action.type === 'setup') return await this.profiles.setup(guild, plan, interaction.user.id);
        if (action.type === 'refresh') await this.profiles.publish(guild);
        else if (action.type === 'rename-channel') await plan.channels.get(action.id).setName(action.name, reason);
        else if (action.type === 'create-channel') await guild.channels.create({ name: action.name, type: ChannelType.GuildText, permissionOverwrites: [
          { id: guild.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads] },
          { id: plan.me.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ManageChannels] },
        ], reason });
        else if (action.type === 'rename-role') { const role = await safeRole(guild, action.id); if (forbiddenRoleName(role.name) || forbiddenRoleName(action.name)) throw new UserError('Staff/bot roles are excluded.'); await role.setName(action.name, reason); }
        else if (action.type === 'create-role') await guild.roles.create({ name: action.name, permissions: [], mentionable: false, reason });
        else if (action.type === 'notification') {
          await this.notifications.validateSettings(guild, action.platform, action.settings);
          this.store.set(guild.id, 'social-settings', action.platform, action.settings);
        } else if (action.type === 'country') {
          const config = configFor(this.store, guild.id); config.profile.countryEnabled = action.enabled;
          this.store.set(guild.id, 'config', 'server', config); await this.profiles.publish(guild);
        } else throw new UserError('Unknown administrative action.');
        return { content: '✅ Reviewed changes applied. Use Refresh Panels after editing role/channel names if you want to republish the panel styling.' };
      } finally { this.store.delete(interaction.guildId, 'admin-reviews', token); }
    });
  }
  async handle(interaction) {
    const [, namespace, action, token] = interaction.customId.split(':');
    if (namespace === 'profile') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const clearing = action.startsWith('clear-');
      const result = await this.profiles.select(interaction, clearing ? action.slice(6) : action, clearing ? [] : interaction.values);
      await interaction.editReply({ ...result, allowedMentions: { parse: [] } }); return;
    }
    await this.authorize(interaction);
    // Showing a modal must be the initial acknowledgement, before deferReply.
    if (['channel-form', 'role-form'].includes(action)) {
      const channel = action === 'channel-form';
      const modal = new ModalBuilder().setCustomId(`voidtide:manage:${action}-submit`).setTitle(channel ? 'Create or rename a channel' : 'Create or rename a safe role')
        .addComponents(field('name', channel ? 'Channel / category name' : 'Nonprivileged role name'), field('id', 'Existing resource ID (blank = create)', false, 20));
      await interaction.showModal(modal); return;
    }
    if (action === 'platform') {
      const platform = interaction.values?.[0]; const choice = SOCIAL_ROLES.find((r) => r.key === platform);
      if (!choice) throw new UserError('Choose a supported notification platform.');
      const settings = this.notifications.settings(interaction.guildId, platform);
      const modal = new ModalBuilder().setCustomId(`voidtide:manage:notification-submit:${platform}`).setTitle(`${choice.name} notification settings`).addComponents(
        field('enabled', 'Enabled? true or false', true, 5, settings.enabled),
        field('channel', 'Destination text channel ID', true, 20, settings.channelId), field('cooldown', 'Minimum minutes between pings (1–1440)', true, 4, settings.cooldownMinutes));
      await interaction.showModal(modal); return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let result;
    if (action === 'confirm' || action === 'cancel') result = await this.confirm(interaction, token, action === 'cancel');
    else if (action === 'setup' || action === 'refresh') result = await this.review(interaction, { type: action });
    else if (action === 'channels' || action === 'roles') result = { embeds: [embed(action === 'channels' ? '📁 Manage Channels' : '🎭 Manage Roles', 'Create or rename using a resource ID. Leave the ID blank to create a resource. Changes require a second confirmation. Privileged roles and permission editing are excluded.')], components: [row(button(action === 'channels' ? 'channel-form' : 'role-form', 'Create / Rename', action === 'channels' ? '📁' : '🎭'))] };
    else if (action === 'notifications') result = { embeds: [embed('🔔 VOIDTIDE | Notification Settings', SOCIAL_ROLES.map((choice) => {
      const settings = this.notifications.settings(interaction.guildId, choice.key);
      return `**${choice.name}** · ${settings.enabled ? 'enabled' : 'disabled'} · ${settings.cooldownMinutes} min cooldown\n${choice.automatic ? 'Official API adapter; requires provider credentials + /stream-config account.' : 'Settings only; automatic delivery unavailable.'}`;
    }).join('\n\n'))], components: [row(new StringSelectMenuBuilder().setCustomId('voidtide:manage:platform').setPlaceholder('Configure a platform').addOptions(SOCIAL_ROLES.map((c) => ({ label: c.name, value: c.key }))))] };
    else if (action === 'countries') {
      const enabled = configFor(this.store, interaction.guildId).profile?.countryEnabled !== false;
      result = { embeds: [embed('🌍 VOIDTIDE | Country Roles', `**${COUNTRY_ROLES.length} optional choices** · ${enabled ? 'enabled' : 'disabled'}\n\nOne flag role per member. Members can remove it anytime. No addresses or precise locations are stored. Flag roles are visible in Discord; this dashboard does not list member choices.`)], components: [row(button(enabled ? 'country-disable' : 'country-enable', enabled ? 'Disable selection' : 'Enable selection', '🌍'))] };
    } else if (action === 'country-enable' || action === 'country-disable') result = await this.review(interaction, { type: 'country', enabled: action === 'country-enable' });
    else if (action === 'channel-form-submit' || action === 'role-form-submit') {
      const name = interaction.fields.getTextInputValue('name').trim(); const id = interaction.fields.getTextInputValue('id').trim();
      if (!name || name.length > 100 || [...name].some((c) => c.codePointAt(0) < 32) || /@everyone|@here/iu.test(name) || (id && !/^[1-9]\d{16,19}$/.test(id))) throw new UserError('Use a valid name (1–100 characters) and a Discord resource ID, or leave the ID blank.');
      result = await this.review(interaction, { type: `${id ? 'rename' : 'create'}-${action.startsWith('channel') ? 'channel' : 'role'}`, name, ...(id ? { id } : {}) });
    } else if (action === 'notification-submit') {
      const enabled = interaction.fields.getTextInputValue('enabled').trim().toLowerCase(); const cooldown = interaction.fields.getTextInputValue('cooldown').trim();
      if (!['true', 'false'].includes(enabled) || !/^\d{1,4}$/.test(cooldown)) throw new UserError('Use true/false and a cooldown from 1 to 1440 minutes.');
      result = await this.review(interaction, { type: 'notification', platform: token, settings: { enabled: enabled === 'true', channelId: interaction.fields.getTextInputValue('channel').trim(), cooldownMinutes: Number(cooldown) } });
    } else throw new UserError('Open /manage-server for the current management controls.');
    await interaction.editReply({ ...result, allowedMentions: { parse: [] } });
  }
  async open(interaction) { await this.authorize(interaction); return this.dashboard(); }
}
