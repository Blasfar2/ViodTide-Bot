import { PermissionFlagsBits as P } from 'discord.js';
import { configFor, requirePermission, textChannel, UserError } from './management-utils.js';
import { levelFor } from './community-service.js';

const permissions = { warn: P.ModerateMembers, timeout: P.ModerateMembers, kick: P.KickMembers, ban: P.BanMembers };
export function assertHierarchy(guild, actor, target, bot, permission) {
  if (!actor.permissions.has(permission) || !bot.permissions.has(permission)) throw new UserError('Both the staff member and bot need the permission for this action.');
  if (target.id === guild.ownerId || target.id === actor.id || target.id === bot.id || target.permissions.has(P.Administrator)) throw new UserError('The owner, administrators, yourself, and this bot are protected.');
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) throw new UserError('You cannot moderate a member with an equal or higher role.');
  if (bot.roles.highest.comparePositionTo(target.roles.highest) <= 0) throw new UserError('The bot cannot moderate a member with an equal or higher role.');
}
export class ModerationService {
  constructor(services) { Object.assign(this, services); this.spam = new Map(); }
  async action(interaction) {
    const kind = interaction.commandName;
    requirePermission(interaction, permissions[kind]);
    const targetUser = interaction.options.getUser('member');
    const target = await interaction.guild.members.fetch({ user: targetUser.id, force: true });
    const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    const bot = await interaction.guild.members.fetchMe({ force: true });
    assertHierarchy(interaction.guild, actor, target, bot, permissions[kind]);
    const reason = interaction.options.getString('reason');
    const id = interaction.id;
    if (this.store.get(interaction.guildId, 'cases', id)) throw new UserError('This action was already processed or its outcome needs staff review. Check moderation cases before repeating it.');
    const record = { id, type: kind, actorId: actor.id, targetId: target.id, reason, status: 'pending', createdAt: Date.now() };
    this.store.set(interaction.guildId, 'cases', id, record);
    try {
      const audit = `VOIDTIDE case ${id}; actor ${actor.id}; ${reason}`.slice(0, 512);
      if (kind === 'warn') this.store.set(interaction.guildId, 'warnings', id, { ...record, status: 'completed' });
      if (kind === 'timeout') {
        if (!target.moderatable) throw new UserError('Discord does not allow timing out this member.');
        await target.timeout(interaction.options.getInteger('minutes') * 60_000, audit);
      }
      if (kind === 'kick') { if (!target.kickable) throw new UserError('This member cannot be kicked by the bot.'); await target.kick(audit); }
      if (kind === 'ban') { if (!target.bannable) throw new UserError('This member cannot be banned by the bot.'); await target.ban({ deleteMessageSeconds: 0, reason: audit }); }
      this.store.set(interaction.guildId, 'cases', id, { ...record, status: 'completed' });
    } catch (error) {
      this.store.set(interaction.guildId, 'cases', id, { ...record, status: 'needs-review' });
      throw error;
    }
    await this.log(interaction.guild, 'mod-logs', `case:${id}`, `Moderation • ${kind}`, `Case: ${id}\nActor: ${actor.id}\nMember: ${target.id}\nReason: ${reason}`);
    return { content: `${kind} completed. Case ID: ${id}.` };
  }
  warnings(interaction) {
    requirePermission(interaction, P.ModerateMembers);
    const target = interaction.options.getUser('member');
    const rows = this.store.list(interaction.guildId, 'warnings').filter(({ value }) => value.targetId === target.id);
    return { content: rows.slice(-10).map(({ key, value }) => `${key}: ${value.reason}`).join('\n').slice(0, 1900) || 'No warnings for this member.' };
  }
  async clear(interaction) {
    requirePermission(interaction, P.ManageMessages);
    const channel = await textChannel(interaction.guild, interaction.channelId, [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages]);
    const count = interaction.options.getInteger('count');
    const messages = await channel.messages.fetch({ limit: count });
    const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    const bot = await interaction.guild.members.fetchMe({ force: true });
    const eligible = new (messages.constructor)();
    for (const message of messages.values()) {
      if (message.pinned || message.author.bot || message.author.id === interaction.guild.ownerId
        || Date.now() - message.createdTimestamp >= 14 * 86400_000 - 60_000) continue;
      let target;
      try { target = await interaction.guild.members.fetch({ user: message.author.id, force: true }); }
      catch (error) { if (error.code === 10007) continue; throw error; }
      try { assertHierarchy(interaction.guild, actor, target, bot, P.ManageMessages); }
      catch { continue; }
      eligible.set(message.id, message);
    }
    const existing = this.store.get(interaction.guildId, 'cases', interaction.id);
    if (existing) throw new UserError('This cleanup interaction was already processed.');
    const record = { type: 'clear', actorId: interaction.user.id, channelId: channel.id, requested: count, status: 'pending', createdAt: Date.now() };
    this.store.set(interaction.guildId, 'cases', interaction.id, record);
    const deleted = eligible.size ? await channel.bulkDelete(eligible, true) : new Map();
    this.store.set(interaction.guildId, 'cases', interaction.id, { ...record, deleted: deleted.size, status: 'completed' });
    await this.log(interaction.guild, 'mod-logs', `case:${interaction.id}`, 'Message cleanup', `Actor: ${interaction.user.id}\nChannel: ${channel.id}\nDeleted: ${deleted.size}\nPinned and messages older than 14 days were preserved.`);
    return { content: `Deleted ${deleted.size} eligible messages. Pinned and old messages were preserved.` };
  }
  async antiSpam(message) {
    if (!configFor(this.store, message.guildId).antiSpamEnabled) return false;
    if (message.member.permissions.any([P.ManageMessages, P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageGuild]) || message.author.id === message.guild.ownerId) return false;
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    // Bound memory even when many different accounts send messages.
    for (const [id, entry] of this.spam) if (now - entry.lastAt > 120_000) this.spam.delete(id);
    const previous = this.spam.get(key) ?? { timestamps: [], actedAt: 0 };
    const timestamps = [...previous.timestamps.filter((time) => now - time < 8000), now];
    this.spam.set(key, { timestamps, actedAt: previous.actedAt, lastAt: now });
    if (timestamps.length < 6) return false;
    if (now - previous.actedAt < 30_000) return true;
    this.spam.set(key, { timestamps, actedAt: now, lastAt: now });
    const xp = this.store.get(message.guildId, 'xp', message.author.id);
    if (xp?.lastAward && now - xp.lastAt < 8000) {
      const corrected = Math.max(0, xp.xp - xp.lastAward);
      this.store.set(message.guildId, 'xp', message.author.id, { ...xp, xp: corrected, lastAward: 0 });
      const previousJob = this.store.get(message.guildId, 'jobs', `rewards:${message.author.id}`);
      this.store.set(message.guildId, 'jobs', `rewards:${message.author.id}`, { type: 'rewards', userId: message.author.id, generation: (previousJob?.generation ?? 0) + 1, runAt: now, status: 'pending', attempts: 0 });
      for (const { key, value } of this.store.list(message.guildId, 'jobs')) if (value.type === 'level' && value.userId === message.author.id && value.level > levelFor(corrected) && ['pending', 'retry'].includes(value.status)) this.store.set(message.guildId, 'jobs', key, { ...value, status: 'cancelled' });
    }
    const me = await message.guild.members.fetchMe({ force: true });
    const member = await message.guild.members.fetch({ user: message.author.id, force: true });
    try { assertHierarchy(message.guild, me, member, me, P.ModerateMembers); }
    catch { return true; }
    const id = `spam:${message.id}`;
    this.store.set(message.guildId, 'cases', id, { type: 'anti-spam', targetId: member.id, actorId: me.id, createdAt: now, status: 'pending' });
    if (!member.moderatable) return true;
    await member.timeout(30_000, 'VOIDTIDE anti-spam: six messages in eight seconds');
    if (message.deletable) await message.delete();
    this.store.set(message.guildId, 'cases', id, { type: 'anti-spam', targetId: member.id, actorId: me.id, createdAt: now, status: 'completed' });
    await this.log(message.guild, 'mod-logs', id, 'Anti-spam timeout', `Member: ${member.id}\nDuration: 30 seconds\nReason: six messages within eight seconds. No message content logged.`);
    return true;
  }
}
