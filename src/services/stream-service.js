import { URL, URLSearchParams } from 'node:url';
import { configFor, embed, requirePermission, sendOnce, textChannel, UserError } from './management-utils.js';

export function validateStream(provider, account) {
  if (provider === 'twitch' && /^[a-z0-9_]{1,25}$/.test(account)) return;
  if (provider === 'youtube' && /^UC[A-Za-z0-9_-]{22}$/.test(account)) return;
  throw new UserError('Use a lowercase Twitch login or a YouTube channel ID beginning UC (24 characters).');
}
export class StreamService {
  constructor({ store, logger, notifications, environment = process.env, fetchImpl = globalThis.fetch, clock = Date.now }) {
    Object.assign(this, { store, logger, notifications, environment, fetchImpl, clock }); this.token = null;
  }
  async request(url, options = {}) {
    const response = await this.fetchImpl(url, { ...options, signal: globalThis.AbortSignal.timeout(15_000) });
    if (!response.ok) throw new UserError(`Streaming provider request failed (HTTP ${response.status}). Check provider credentials, account configuration, and quotas.`);
    return response.json();
  }
  async configure(interaction) {
    requirePermission(interaction);
    const action = interaction.options.getSubcommand();
    if (action === 'list') {
      const rows = this.store.list(interaction.guildId, 'streams');
      const credentials = `Twitch credentials: ${this.environment.TWITCH_CLIENT_ID && this.environment.TWITCH_CLIENT_SECRET ? 'present' : 'missing'}; YouTube API key: ${this.environment.YOUTUBE_API_KEY ? 'present' : 'missing'}. Presence is not an authentication test.`;
      return { content: `${rows.map(({ key, value }) => `${key} → <#${value.channelId}>`).join('\n') || 'No stream accounts configured.'}\n${credentials}\nPolling runs every five minutes while this process is running.`.slice(0, 1900) };
    }
    const provider = interaction.options.getString('provider');
    const account = interaction.options.getString('account'); validateStream(provider, account);
    const key = `${provider}:${account}`;
    if (action === 'remove') { this.store.delete(interaction.guildId, 'streams', key); return { content: 'Notification account removed.' }; }
    if (this.store.list(interaction.guildId, 'streams').length >= 20 && !this.store.get(interaction.guildId, 'streams', key)) throw new UserError('At most 20 notification accounts are supported per server.');
    const channel = interaction.options.getChannel('channel'); await textChannel(interaction.guild, channel.id);
    if (configFor(this.store, interaction.guildId).profile?.ready && this.notifications && this.notifications.settings(interaction.guildId, provider).channelId !== channel.id) throw new UserError('Profile alerts use one destination per platform. Set it through /manage-server → Notification Settings first, then select that same channel here.');
    const previous = this.store.get(interaction.guildId, 'streams', key);
    this.store.set(interaction.guildId, 'streams', key, { ...previous, provider, account, channelId: channel.id, revision: (previous?.revision ?? 0) + 1 });
    return { content: 'Notification account saved. Add the required provider credentials securely in environment variables. YouTube establishes a latest-upload baseline on its first check; Twitch can announce an already-live stream.' };
  }
  async twitch(account) {
    const { TWITCH_CLIENT_ID: clientId, TWITCH_CLIENT_SECRET: secret } = this.environment;
    if (!clientId || !secret) throw new UserError('Twitch notifications need TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the process environment.');
    if (!this.token || this.token.expires <= this.clock() + 60_000) {
      const response = await this.request('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }).toString() });
      if (!response.access_token || !Number.isFinite(response.expires_in)) throw new UserError('Twitch returned an invalid authentication response.');
      this.token = { value: response.access_token, expires: this.clock() + response.expires_in * 1000 };
    }
    const url = new URL('https://api.twitch.tv/helix/streams'); url.searchParams.set('user_login', account);
    let result;
    try { result = await this.request(url, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${this.token.value}` } }); }
    catch (error) { this.token = null; throw error; }
    const stream = result.data?.[0];
    return stream ? { id: stream.id, title: `${stream.user_name} is live`, description: `${stream.title}\nhttps://www.twitch.tv/${account}` } : null;
  }
  async youtube(record) {
    const key = this.environment.YOUTUBE_API_KEY;
    if (!key) throw new UserError('YouTube notifications need YOUTUBE_API_KEY in the process environment.');
    const request = (endpoint, parameters) => {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
      for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
      return this.request(url, { headers: { 'X-Goog-Api-Key': key } });
    };
    let playlist = record.playlist;
    if (!playlist) {
      const channel = await request('channels', { part: 'contentDetails', id: record.account });
      playlist = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!playlist) throw new UserError('The YouTube uploads playlist could not be found. Check the channel ID and API access.');
    }
    const latest = await request('playlistItems', { part: 'snippet', playlistId: playlist, maxResults: '50' });
    const items = (latest.items ?? []).flatMap(({ snippet }) => {
      const id = snippet?.resourceId?.videoId;
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? [{ id, title: `${snippet.channelTitle} • New upload`, description: `${snippet.title}\nhttps://www.youtube.com/watch?v=${id}` }] : [];
    });
    return { playlist, items };
  }
  async tick(guild) {
    for (const { key, value } of this.store.list(guild.id, 'streams')) {
      if (configFor(this.store, guild.id).profile?.ready && this.notifications?.settings(guild.id, value.provider).enabled === false) continue;
      if (this.clock() - (value.checkedAt ?? 0) < 300_000) continue;
      this.store.set(guild.id, 'streams', key, { ...value, checkedAt: this.clock() });
      try {
        validateStream(value.provider, value.account);
        let items; let playlist = value.playlist;
        if (value.provider === 'twitch') { const item = await this.twitch(value.account); items = item ? [item] : []; }
        else { const result = await this.youtube(value); items = result.items; playlist = result.playlist; }
        const current = this.store.get(guild.id, 'streams', key);
        if (!current || current.revision !== value.revision) continue;
        const knownIndex = items.findIndex((item) => item.id === value.lastId);
        const unseen = (knownIndex >= 0 ? items.slice(0, knownIndex) : [...items]).reverse();
        if (value.provider === 'twitch' || value.initialized) for (const item of unseen) {
          if (this.notifications) await this.notifications.deliver(guild, value.provider, `stream:${key}:${item.id}`, item, value.channelId);
          else {
            const channel = await textChannel(guild, value.channelId);
            await sendOnce(this.store, channel, `stream:${key}:${item.id}`, { embeds: [embed(item.title.slice(0, 256), item.description.slice(0, 4096))] });
          }
        }
        if (this.store.get(guild.id, 'streams', key)?.revision === value.revision) this.store.set(guild.id, 'streams', key, { ...value, checkedAt: this.clock(), playlist: playlist ?? null, lastId: items[0]?.id ?? value.lastId ?? null, initialized: true, error: false });
      } catch (error) {
        this.logger.error('Streaming check failed. Check provider configuration, credentials and quotas.', error);
        if (this.store.get(guild.id, 'streams', key)?.revision === value.revision) this.store.set(guild.id, 'streams', key, { ...value, checkedAt: this.clock(), error: true });
      }
    }
  }
  status(guildId) { return { accounts: this.store.list(guildId, 'streams').length, configured: Boolean(configFor(this.store, guildId).complete) }; }
}
