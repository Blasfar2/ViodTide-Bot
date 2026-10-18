import { createHash, randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits as P } from 'discord.js';
import { configFor, embed, futureTime, httpsURL, requirePermission, requireStaff, safeRole, sendOnce, textChannel, UserError } from './management-utils.js';
import { SELF_ROLES } from '../config/server-layout.js';

export const levelFor = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100));
export function eligibleXP(message, previous, now) {
  const normalized = message.content?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const meaningful = (normalized.match(/[\p{L}\p{N}]/gu) ?? []).length >= 8;
  const hash = createHash('sha256').update(normalized).digest('hex');
  return { eligible: meaningful && now - (previous?.lastAt ?? 0) >= 60_000 && hash !== previous?.lastHash, hash };
}
export class CommunityService {
  constructor(services) { Object.assign(this, services); }
  announcementData(interaction) {
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const image = httpsURL(interaction.options.getString('image'));
    const link = httpsURL(interaction.options.getString('link'));
    const item = embed(title, description);
    if (image) item.setImage(image);
    if (link) item.setURL(link);
    return { embeds: [item.toJSON()] };
  }
  async announce(interaction) {
    requireStaff(interaction);
    const channel = await textChannel(interaction.guild, configFor(this.store, interaction.guildId).channels?.announcements);
    await sendOnce(this.store, channel, `announcement:${interaction.id}`, this.announcementData(interaction));
    return { content: 'Announcement published without mass mentions.' };
  }
  async schedule(interaction) {
    requireStaff(interaction);
    const action = interaction.options.getSubcommand();
    if (action === 'list') {
      const rows = this.store.list(interaction.guildId, 'jobs').filter(({ value }) => value.type === 'announcement');
      return { content: rows.slice(-20).map(({ key, value }) => `${key}: ${value.status}, <t:${Math.floor(value.runAt / 1000)}:F>`).join('\n') || 'No scheduled announcements.' };
    }
    if (action === 'cancel') {
      const id = interaction.options.getString('id'); const job = this.store.get(interaction.guildId, 'jobs', id);
      if (!job || job.type !== 'announcement' || !['pending', 'retry'].includes(job.status)) throw new UserError('No pending announcement with that ID.');
      this.store.set(interaction.guildId, 'jobs', id, { ...job, status: 'cancelled' });
      return { content: 'Scheduled announcement cancelled.' };
    }
    const channelId = configFor(this.store, interaction.guildId).channels?.announcements;
    await textChannel(interaction.guild, channelId);
    const id = interaction.id;
    if (!this.store.get(interaction.guildId, 'jobs', id)) this.store.set(interaction.guildId, 'jobs', id, {
      type: 'announcement', status: 'pending', channelId, runAt: futureTime(interaction.options.getString('time')),
      payload: this.announcementData(interaction), createdBy: interaction.user.id, attempts: 0,
    });
    return { content: `Scheduled announcement saved. Job ID: ${id}. It is delivered only while the bot process is running; overdue jobs resume after restart.` };
  }
  async memberEvent(member, joined) {
    if (member.guild.id !== this.guildId || member.user.bot) return;
    const config = configFor(this.store, member.guild.id);
    if (!config.welcomeEnabled) return;
    const channel = await textChannel(member.guild, config.channels?.welcome);
    const key = `${joined ? 'welcome' : 'goodbye'}:${member.id}:${member.joinedTimestamp ?? 'unknown'}`;
    const text = joined
      ? `Welcome <@${member.id}> to VOIDTIDE! 🌊\nRead <#${config.channels['📜・rules']}> and press **✅ I Agree** to verify.\nWe welcome Deaf, hard-of-hearing, and hearing members. Important information is always available in text.\nMembers: **${member.guild.memberCount}**.`
      : `Goodbye <@${member.id}>. We wish you well.\nMembers: **${member.guild.memberCount}**.`;
    await sendOnce(this.store, channel, key, { embeds: [embed(joined ? 'Welcome to VOIDTIDE' : 'Goodbye from VOIDTIDE', text)], allowedMentions: { parse: [], users: joined ? [member.id] : [] } });
    if (joined && !member.pending && config.roles?.Newcomer) {
      await safeRole(member.guild, config.roles.Newcomer);
      await member.roles.add(config.roles.Newcomer, 'New member newcomer label; no privileged access');
    }
  }
  async xpMessage(message) {
    const config = configFor(this.store, message.guildId);
    if (!config.xpEnabled || !config.roles?.Verified || !message.member?.roles.cache.has(config.roles.Verified)) return;
    const allowed = ['general', 'sign-language', 'media', 'gaming-chat', 'looking-for-group', 'clips', 'events'].map((name) => config.channels?.[name]);
    if (!allowed.includes(message.channelId)) return;
    const previous = this.store.get(message.guildId, 'xp', message.author.id) ?? { xp: 0 };
    const eligibility = eligibleXP(message, previous, Date.now());
    if (!eligibility.eligible) return;
    const next = { xp: previous.xp + 15, lastAt: Date.now(), lastHash: eligibility.hash, lastAward: 15, lastMessageId: message.id };
    this.store.set(message.guildId, 'xp', message.author.id, next);
    if (levelFor(next.xp) > levelFor(previous.xp)) {
      this.store.set(message.guildId, 'jobs', `level:${message.author.id}:${levelFor(next.xp)}`, { type: 'level', userId: message.author.id, level: levelFor(next.xp), runAt: Date.now(), status: 'pending', attempts: 0 });
    }
    const previousJob = this.store.get(message.guildId, 'jobs', `rewards:${message.author.id}`);
    this.store.set(message.guildId, 'jobs', `rewards:${message.author.id}`, { type: 'rewards', userId: message.author.id, generation: (previousJob?.generation ?? 0) + 1, runAt: Date.now(), status: 'pending', attempts: 0 });
  }
  async syncRewards(member, xp, config = configFor(this.store, member.guild.id)) {
    const level = levelFor(xp);
    for (const reward of [5, 10, 20, 30, 50]) {
      const id = config.roles?.[`Level ${reward}`]; if (!id) continue;
      if (level >= reward && !member.roles.cache.has(id)) { await safeRole(member.guild, id); await member.roles.add(id, 'VOIDTIDE level reward'); }
      if (level < reward && member.roles.cache.has(id)) { await safeRole(member.guild, id); await member.roles.remove(id, 'XP administrator adjustment'); }
    }
  }
  async rank(interaction) {
    const user = interaction.options.getUser('member') ?? interaction.user;
    const rows = this.store.list(interaction.guildId, 'xp').sort((a, b) => b.value.xp - a.value.xp || a.key.localeCompare(b.key));
    const data = this.store.get(interaction.guildId, 'xp', user.id) ?? { xp: 0 };
    const level = levelFor(data.xp);
    return { embeds: [embed('VOIDTIDE • Rank', `<@${user.id}>\nLevel **${level}** • **${data.xp} XP**\nNext level: **${100 * (level + 1) ** 2} XP**\nRank: **${rows.findIndex((row) => row.key === user.id) + 1 || 'unranked'}**`)] };
  }
  async leaderboard(interaction) {
    const rows = this.store.list(interaction.guildId, 'xp').sort((a, b) => b.value.xp - a.value.xp || a.key.localeCompare(b.key));
    return { embeds: [embed('VOIDTIDE • Leaderboard', rows.slice(0, 10).map((r, n) => `${n + 1}. <@${r.key}> — Level ${levelFor(r.value.xp)} • ${r.value.xp} XP`).join('\n') || 'No XP earned yet.')] };
  }
  async xpAdmin(interaction) {
    requirePermission(interaction);
    const user = interaction.options.getUser('member');
    const member = await interaction.guild.members.fetch({ user: user.id, force: true });
    if (member.user.bot) throw new UserError('Bot accounts cannot earn community XP.');
    const xp = interaction.options.getInteger('xp');
    const previous = this.store.get(interaction.guildId, 'xp', user.id) ?? {};
    this.store.set(interaction.guildId, 'xp', user.id, { ...previous, xp, lastAward: 0 });
    const key = `rewards:${user.id}`;
    const oldJob = this.store.get(interaction.guildId, 'jobs', key);
    const job = { type: 'rewards', userId: user.id, generation: (oldJob?.generation ?? 0) + 1, runAt: Date.now(), status: 'pending', attempts: 0 };
    this.store.set(interaction.guildId, 'jobs', key, job);
    this.store.set(interaction.guildId, 'cases', `xp:${interaction.id}`, { type: 'xp-admin', actorId: interaction.user.id, targetId: user.id, xp, createdAt: Date.now(), status: 'completed' });
    await this.syncRewards(member, xp);
    if (this.store.get(interaction.guildId, 'jobs', key)?.generation === job.generation) this.store.set(interaction.guildId, 'jobs', key, { ...job, status: 'completed' });
    await this.log(interaction.guild, 'mod-logs', `xp-admin:${interaction.id}`, 'XP adjustment', `Actor: ${interaction.user.id}\nMember: ${user.id}\nXP set to ${xp}.`);
    return { content: `XP set to ${xp}; reward roles synchronized.` };
  }
  async levelRewards(interaction) {
    const config = configFor(this.store, interaction.guildId);
    return { embeds: [embed('VOIDTIDE • Level Rewards', [5, 10, 20, 30, 50].map((n) => `Level **${n}** — ${config.roles?.[`Level ${n}`] ? `<@&${config.roles[`Level ${n}`]}>` : 'not configured'}`).join('\n'))] };
  }
  async rolePanel(guild, config) {
    const me = await guild.members.fetchMe({ force: true });
    if (!me.permissions.has(P.ManageRoles)) throw new UserError('The bot needs Manage Roles for the role panel.');
    const channel = await textChannel(guild, config.channels['choose-roles']);
    if (!channel.permissionsFor(guild.roles.everyone)?.has([P.ViewChannel, P.ReadMessageHistory])) throw new UserError('The role panel must be public. Run /setup-server to preview the new public role channel; existing permissions are never changed automatically.');
    for (const role of SELF_ROLES) await safeRole(guild, config.roles[role.name]);
    const legacy = this.store.get(guild.id, 'deliveries', 'panel:roles');
    if (!this.store.get(guild.id, 'deliveries', 'panel:roles:v2') && legacy?.channelId === channel.id) this.store.set(guild.id, 'deliveries', 'panel:roles:v2', legacy);
    const panel = await sendOnce(this.store, channel, 'panel:roles:v2', {
      embeds: [embed('🎭 Choose Your VOIDTIDE Roles', '**Make VOIDTIDE yours.**\n\n🎮 **Gamer** — gaming interests\n🔴 **Live Notification** — live-stream alerts\n🎬 **Video Notification** — new videos and clips\n🤟 **Sign Language** — communication preference\n🏆 **Events** — community events\n\nClick to add a role. Click again to remove it. These roles grant no privileges or private-channel access. Staff manage channel access and privileged roles.')],
      components: [new ActionRowBuilder().addComponents(SELF_ROLES.map((role) => new ButtonBuilder().setCustomId(`voidtide:role:${role.key}`).setLabel(role.name).setEmoji(role.emoji).setStyle(ButtonStyle.Secondary)))],
    }, { edit: true });
    if (legacy?.messageId && legacy.channelId !== channel.id) {
      try {
        const previous = await guild.channels.fetch(legacy.channelId);
        const message = previous && await previous.messages.fetch({ message: legacy.messageId, force: true });
        if (message?.author.id === guild.client.user.id) await message.edit({ content: `Role selection moved to <#${channel.id}>.`, embeds: [], components: [], allowedMentions: { parse: [] } });
      } catch (error) { if (![10003, 10008].includes(error.code)) throw error; }
    }
    return panel;
  }
  async toggleRole(interaction, key) {
    const config = configFor(this.store, interaction.guildId);
    const choice = SELF_ROLES.find((role) => role.key === key);
    if (!choice) throw new UserError('This role is not self-assignable. Use the current five-role panel.');
    const saved = this.store.get(interaction.guildId, 'deliveries', 'panel:roles:v2');
    if (saved?.messageId !== interaction.message.id || saved.channelId !== interaction.channelId) throw new UserError('Use the current role panel.');
    return this.store.lock(`role:${interaction.guildId}:${interaction.user.id}`, async () => {
      const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
      if (member.user.bot) throw new UserError('Role selection is for community members, not bots.');
      if (member.pending) throw new UserError('Complete Discord membership screening before choosing roles.');
      const role = await safeRole(interaction.guild, config.roles?.[choice.name]);
      const removing = member.roles.cache.has(role.id);
      await member.roles[removing ? 'remove' : 'add'](role, 'Member selected a nonprivileged community role');
      return { content: `${choice.emoji} ${choice.name} ${removing ? 'removed' : 'added'}.` };
    });
  }
  job(payload) { return { ...payload, id: randomUUID(), attempts: 0, status: 'pending' }; }
}
