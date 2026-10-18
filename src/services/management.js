import { setInterval, clearInterval } from 'node:timers';
import { PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../database/store.js';
import { CommunityService } from './community-service.js';
import { ModerationService } from './moderation-service.js';
import { PollService } from './poll-service.js';
import { ServerSetup } from './server-setup.js';
import { AutoFix } from './auto-fix.js';
import { StreamService } from './stream-service.js';
import { TicketService } from './ticket-service.js';
import { staffRoleIds } from '../config/server-layout.js';
import { configFor, embed, requirePermission, requireStaff, safeRole, sendOnce, textChannel, UserError } from './management-utils.js';

export class Management {
  constructor({ client, guildId, logger, rulesService, store = new Store(), environment = process.env, fetchImpl }) {
    Object.assign(this, { client, guildId, logger, rulesService, store });
    const shared = { store, logger, guildId, rulesService, log: this.log.bind(this) };
    this.community = new CommunityService(shared);
    this.tickets = new TicketService(shared);
    this.moderation = new ModerationService(shared);
    this.polls = new PollService(shared);
    this.streams = new StreamService({ ...shared, environment, fetchImpl });
    this.setup = new ServerSetup({ ...shared, panels: async (guild, config) => {
      await this.tickets.panel(guild, config); await this.community.rolePanel(guild, config);
    } });
    this.autoFix = new AutoFix({ ...shared, setup: this.setup });
    this.running = false;
    this.active = new Set(); this.stopping = false;
  }
  run(callback) {
    if (this.stopping) return Promise.reject(new UserError('The bot is restarting. Please try again shortly.'));
    const operation = Promise.resolve().then(callback);
    this.active.add(operation);
    operation.then(() => this.active.delete(operation), () => this.active.delete(operation));
    return operation;
  }
  async log(guild, channelName, id, title, description) {
    const config = configFor(this.store, guild.id);
    if (!config.channels?.[channelName]) return;
    const channel = await textChannel(guild, config.channels[channelName]);
    const roles = await guild.roles.fetch();
    const verifiedRole = roles.get(config.roles?.Verified);
    if (channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel)
      || (verifiedRole && channel.permissionsFor(verifiedRole).has(P.ViewChannel))) throw new UserError('The log channel is not private. No confidential log was posted.');
    const staff = staffRoleIds(roles, guild.id);
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.allow.has(P.ViewChannel, false) && ![guild.client.user.id, guild.ownerId, ...staff].includes(overwrite.id)
        && !roles.get(overwrite.id)?.permissions.has(P.Administrator)) throw new UserError('The log channel has an unrelated access grant. Staff must review it.');
    }
    await sendOnce(this.store, channel, id, { embeds: [embed(title, description.slice(0, 4096))] });
  }
  async execute(interaction) {
    const name = interaction.commandName;
    if (name === 'auto-fix') return this.autoFix.run(interaction);
    if (['setup-server', 'setup-roles', 'setup-channels'].includes(name)) return this.setup.run(interaction, name.slice(6));
    if (['setup-status', 'channel-status'].includes(name)) { requirePermission(interaction); return this.setup.status(interaction.guild); }
    if (name === 'announce') return this.community.announce(interaction);
    if (name === 'schedule-announcement') return this.community.schedule(interaction);
    if (name === 'rank') return this.community.rank(interaction);
    if (name === 'leaderboard') return this.community.leaderboard(interaction);
    if (name === 'level-rewards') return this.community.levelRewards(interaction);
    if (name === 'xp-admin') return this.community.xpAdmin(interaction);
    if (name === 'role-panel') { requirePermission(interaction); await this.community.rolePanel(interaction.guild, configFor(this.store, interaction.guildId)); return { content: 'Role panel published or updated.' }; }
    if (name === 'ticket-panel') { requirePermission(interaction); await this.tickets.panel(interaction.guild, configFor(this.store, interaction.guildId)); return { content: 'Ticket panel published or updated.' }; }
    if (name === 'ticket') return this.tickets.open(interaction, interaction.options.getString('category'));
    if (name === 'close-ticket') return this.tickets.close(interaction);
    if (['warn', 'timeout', 'kick', 'ban'].includes(name)) return this.moderation.action(interaction);
    if (name === 'warnings') return this.moderation.warnings(interaction);
    if (name === 'clear') return this.moderation.clear(interaction);
    if (name === 'poll') return this.polls.create(interaction);
    if (name === 'event') return this.polls.event(interaction);
    if (name === 'stream-config') return this.streams.configure(interaction);
    if (name === 'welcome-config') {
      requirePermission(interaction);
      const config = configFor(this.store, interaction.guildId);
      const channel = interaction.options.getChannel('channel');
      if (channel || interaction.options.getBoolean('enabled')) {
        const destination = await textChannel(interaction.guild, channel?.id ?? config.channels?.welcome);
        if (!destination.permissionsFor(interaction.guild.roles.everyone).has([P.ViewChannel, P.ReadMessageHistory])) throw new UserError('Choose a welcome channel that unverified newcomers can view and read.');
        if (channel) {
          const state = await this.rulesService.store.get(interaction.guildId) ?? {};
          await this.rulesService.store.set(interaction.guildId, { publicChannelIds: [...new Set([...(state.publicChannelIds ?? []).filter((id) => id !== config.channels?.welcome), channel.id])] });
          config.channels = { ...config.channels, welcome: channel.id };
        }
      }
      config.welcomeEnabled = interaction.options.getBoolean('enabled');
      this.store.set(interaction.guildId, 'config', 'server', config);
      return { content: `Welcome and goodbye messages ${config.welcomeEnabled ? 'enabled' : 'disabled'}. Review newcomer visibility if you selected another channel.` };
    }
    if (name === 'jobs') {
      requireStaff(interaction);
      return { content: this.store.list(interaction.guildId, 'jobs').slice(-20).map(({ key, value }) => `${key}: ${value.type}, ${value.status}, attempts ${value.attempts}`).join('\n').slice(0, 1900) || 'No background jobs.' };
    }
    throw new UserError('This command is not implemented.');
  }
  async button(interaction) {
    const [, kind, id, value] = interaction.customId.split(':');
    if (kind === 'ticket') return this.tickets.open(interaction, ['General Help', 'Report Member', 'Technical Help', 'Partnership'][Number(id)]);
    if (kind === 'close') return this.tickets.close(interaction, id);
    if (kind === 'role') return this.community.toggleRole(interaction, id);
    if (kind === 'poll') return this.polls.vote(interaction, id, Number(value));
    throw new UserError('This button is no longer supported.');
  }
  async message(message) {
    if (message.guildId !== this.guildId || message.author.bot || message.webhookId || !message.member) return;
    if (await this.moderation.antiSpam(message)) return;
    await this.community.xpMessage(message);
  }
  async afterVerify(interaction) {
    const config = configFor(this.store, interaction.guildId);
    const id = config.roles?.Newcomer;
    if (!id || !config.roles?.Verified) return;
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    if (member.roles.cache.has(config.roles.Verified) && member.roles.cache.has(id)) {
      await safeRole(interaction.guild, id);
      await member.roles.remove(id, 'Member completed VOIDTIDE verification');
    }
  }
  start() {
    if (this.timer) return;
    const tick = () => {
      if (this.worker) return;
      this.worker = this.tick().catch((error) => this.logger.error('Background worker failed.', error)).finally(() => { this.worker = null; });
    };
    this.timer = setInterval(tick, 15_000); this.timer.unref(); void tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async shutdown() {
    if (this.closing) return this.closing;
    this.closing = this.finishShutdown();
    return this.closing;
  }
  async finishShutdown() {
    this.stopping = true; this.stop();
    if (this.worker) await this.worker;
    await Promise.allSettled([...this.active]);
    this.store.close();
  }
  async tick() {
    if (this.running || !this.client.isReady()) return;
    this.running = true;
    try {
      const guild = this.client.guilds.cache.get(this.guildId); if (!guild) return;
      const due = this.store.list(this.guildId, 'jobs').filter(({ value }) => ['pending', 'retry', 'running'].includes(value.status)
        && value.runAt <= Date.now() && (value.status !== 'running' || value.leaseUntil <= Date.now())).sort((a, b) => a.value.runAt - b.value.runAt || a.key.localeCompare(b.key)).slice(0, 10);
      for (const { key, value } of due) {
        this.store.set(this.guildId, 'jobs', key, { ...value, status: 'running', leaseUntil: Date.now() + 120_000 });
        try {
          if (value.type === 'announcement') {
            const author = await guild.members.fetch({ user: value.createdBy, force: true });
            if (!author.permissions.has(P.ManageMessages)) throw new UserError('Scheduled announcement author no longer has staff permission.');
            await sendOnce(this.store, await textChannel(guild, value.channelId), `job:${key}`, value.payload);
          }
          else if (value.type === 'poll') await this.polls.close(guild, value.pollId);
          else if (value.type === 'rewards') {
            const member = await guild.members.fetch({ user: value.userId, force: true });
            await this.community.syncRewards(member, this.store.get(guild.id, 'xp', value.userId)?.xp ?? 0);
          } else if (value.type === 'level') {
            const config = configFor(this.store, guild.id);
            await sendOnce(this.store, await textChannel(guild, config.channels?.leaderboard), `level:${value.userId}:${value.level}`, { embeds: [embed('VOIDTIDE • Level Up', `<@${value.userId}> reached **level ${value.level}**!`)] });
          } else throw new UserError('Unknown saved job type.');
          if (this.store.get(this.guildId, 'jobs', key)?.generation === value.generation) this.store.set(this.guildId, 'jobs', key, { ...value, status: 'completed', completedAt: Date.now() });
        } catch (error) {
          const attempts = value.attempts + 1;
          if (this.store.get(this.guildId, 'jobs', key)?.generation === value.generation) this.store.set(this.guildId, 'jobs', key, { ...value, attempts, status: attempts >= 5 ? 'failed' : 'retry', runAt: Date.now() + Math.min(3600_000, 60_000 * 2 ** attempts) });
          this.logger.error('A persistent job failed. Review /jobs and bot permissions.', error);
        }
      }
      await this.streams.tick(guild);
    } finally { this.running = false; }
  }
}
