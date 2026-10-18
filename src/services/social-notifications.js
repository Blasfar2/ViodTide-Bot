import { PermissionFlagsBits as P } from 'discord.js';
import { SOCIAL_ROLES } from '../config/profile.js';
import { configFor, embed, sendOnce, textChannel, UserError } from './management-utils.js';

/** Delivery boundary for official adapters; no arbitrary message, role or mass-mention inputs. */
export class SocialNotifications {
  constructor({ store, profiles, clock = Date.now }) { Object.assign(this, { store, profiles, clock }); }
  settings(guildId, platform) {
    const config = configFor(this.store, guildId);
    const destination = { twitch: 'live-now', youtube: 'social-youtube', tiktok: 'tiktok', instagram: 'instagram', x: 'social-updates' }[platform];
    return this.store.get(guildId, 'social-settings', platform) ?? { enabled: true, cooldownMinutes: 5, channelId: config.channels?.[destination] ?? null };
  }
  async validateSettings(guild, platform, settings) {
    if (!SOCIAL_ROLES.some((c) => c.key === platform) || typeof settings.enabled !== 'boolean' || !Number.isInteger(settings.cooldownMinutes)
      || settings.cooldownMinutes < 1 || settings.cooldownMinutes > 1440 || !/^[1-9]\d{16,19}$/.test(settings.channelId ?? '')) throw new UserError('Select a platform, a text channel ID and a cooldown from 1 to 1440 minutes.');
    const channel = await textChannel(guild, settings.channelId);
    if (!channel.permissionsFor(guild.roles.everyone)?.has([P.ViewChannel, P.ReadMessageHistory])) throw new UserError('Choose a publicly readable social notification channel. Existing permissions stay unchanged.');
    const config = configFor(this.store, guild.id); const choice = SOCIAL_ROLES.find((c) => c.key === platform);
    await this.profiles.approvedRole(guild, config, 'social', choice);
  }
  async deliver(guild, provider, key, item, fallbackChannelId) {
    const config = configFor(this.store, guild.id);
    // Existing installations keep working without new pings until profile setup is confirmed.
    if (!config.profile?.ready) return sendOnce(this.store, await textChannel(guild, fallbackChannelId), key, { embeds: [embed(item.title.slice(0, 256), item.description.slice(0, 4096))] });
    return this.store.lock(`social-send:${guild.id}:${provider}`, async () => {
      const receipt = this.store.get(guild.id, 'social-deliveries', key);
      if (receipt?.status === 'sent') return;
      const choice = SOCIAL_ROLES.find((c) => c.key === provider);
      if (!choice?.automatic) throw new UserError('Automatic delivery is unavailable for this platform. Configure a compliant integration before using it.');
      const settings = this.settings(guild.id, provider);
      if (!settings.enabled) throw new UserError('This platform’s notifications are disabled.');
      await this.validateSettings(guild, provider, settings);
      const role = await this.profiles.approvedRole(guild, config, 'social', choice);
      const channel = await textChannel(guild, settings.channelId);
      const me = await guild.members.fetchMe({ force: true });
      // Do not make public roles mentionable or silently grant permission. Missing permission is actionable.
      if (!role.mentionable && !channel.permissionsFor(me)?.has(P.MentionEveryone)) throw new UserError('To ping the opt-in role, the bot needs Mention Everyone in this notification channel. No role or channel permissions were changed. allowedMentions still permits only the platform role.');
      const last = this.store.get(guild.id, 'social-limits', provider);
      if (!receipt && last && this.clock() - last.at < settings.cooldownMinutes * 60_000) throw new UserError('Platform cooldown active; this notification will be retried without advancing its checkpoint.');
      if (receipt && (receipt.channelId !== channel.id || receipt.roleId !== role.id)) throw new UserError('An unfinished notification belongs to previous settings. Staff must review it before retrying.');
      // Reserve before sending. Lost responses reuse the same delivery key/nonce and do not consume another ping.
      this.store.transaction(() => {
        if (!receipt) this.store.set(guild.id, 'social-deliveries', key, { channelId: channel.id, roleId: role.id, status: 'sending' });
        this.store.set(guild.id, 'social-limits', provider, { at: this.clock(), key });
      });
      await sendOnce(this.store, channel, key, { content: `<@&${role.id}>`, allowedMentions: { parse: [], roles: [role.id], users: [], repliedUser: false },
        embeds: [embed(item.title.slice(0, 256), item.description.slice(0, 4096)).setColor(0x22d3ee)] });
      this.store.set(guild.id, 'social-deliveries', key, { channelId: channel.id, roleId: role.id, status: 'sent' });
    });
  }
}
