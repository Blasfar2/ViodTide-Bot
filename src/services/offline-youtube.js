import { URL } from 'node:url';
import { EmbedBuilder, REST } from 'discord.js';
import { ConfigError, readConfig } from '../config/env.js';
import { UserError } from './management-utils.js';
import { offlineMessageHistory, platformCooldownActive, postOfflineAlert, snowflake, validateOfflineDestination } from './offline-discord.js';
import { StreamService } from './stream-service.js';

export function readOfflineYouTubeConfig(environment = process.env) {
  if (!environment.VOIDTIDE_OFFLINE_YOUTUBE_ENABLED || environment.VOIDTIDE_OFFLINE_YOUTUBE_ENABLED === 'false') return null;
  if (environment.VOIDTIDE_OFFLINE_YOUTUBE_ENABLED !== 'true') throw new ConfigError('VOIDTIDE_OFFLINE_YOUTUBE_ENABLED must be true or false.');
  const discord = readConfig(environment);
  if (!environment.YOUTUBE_API_KEY?.trim()) throw new ConfigError('Missing required environment variable: YOUTUBE_API_KEY.');
  const handle = environment.YOUTUBE_HANDLE?.trim() || '@VoidtidePASV';
  if (!/^@[\p{L}\p{N}_.-]{3,30}$/u.test(handle)) throw new ConfigError('YOUTUBE_HANDLE must be a YouTube handle starting with @, without the website URL.');
  const minutes = environment.YOUTUBE_ALERT_COOLDOWN_MINUTES || '5';
  if (!/^\d{1,4}$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 1440) throw new ConfigError('YOUTUBE_ALERT_COOLDOWN_MINUTES must be an integer from 1 to 1440.');
  return { ...discord, provider: 'youtube', handle, channelId: snowflake(environment, 'YOUTUBE_DISCORD_CHANNEL_ID'), roleId: snowflake(environment, 'YOUTUBE_NOTIFICATION_ROLE_ID'), cooldown: Number(minutes) * 60_000 };
}

function thumbnail(snippet, videoId) {
  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    try {
      const url = new URL(snippet.thumbnails?.[size]?.url);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && (url.hostname === 'ytimg.com' || url.hostname.endsWith('.ytimg.com') || url.hostname === 'img.youtube.com')) return url.toString();
    } catch { /* Missing/untrusted image: try another official thumbnail size. */ }
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Official Data API only: resolve the handle, inspect uploads, then fetch public video metadata. */
export async function youtubeUploads(config, { environment = process.env, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const provider = new StreamService({ environment, fetchImpl, clock });
  const request = (endpoint, parameters) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return provider.request(url, { headers: { 'X-Goog-Api-Key': environment.YOUTUBE_API_KEY.trim() } });
  };
  const response = await request('channels', { part: 'contentDetails', forHandle: config.handle });
  const channel = response.items?.[0]; const playlist = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel?.id ?? '') || typeof playlist !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(playlist)) throw new UserError('The YouTube channel or uploads playlist could not be resolved. Check the handle and enable YouTube Data API v3 for your API key.');
  const uploads = await request('playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: '50' });
  if (!Array.isArray(uploads.items)) throw new UserError('YouTube returned invalid uploads. No notification was sent.');
  const ids = [...new Set(uploads.items.map((item) => item.contentDetails?.videoId).filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id ?? '')))];
  if (!ids.length) return { account: channel.id, items: [] };
  const details = await request('videos', { part: 'snippet,status', id: ids.join(',') });
  if (!Array.isArray(details.items)) throw new UserError('YouTube returned invalid video metadata. No notification was sent.');
  const items = details.items.flatMap((video) => {
    const snippet = video.snippet; const publishedAt = Date.parse(snippet?.publishedAt);
    if (!ids.includes(video.id) || !snippet || snippet.channelId !== channel.id || video.status?.privacyStatus !== 'public'
      || snippet.liveBroadcastContent === 'upcoming' || !Number.isFinite(publishedAt) || publishedAt > clock()
      || typeof snippet.title !== 'string' || !snippet.title.trim()) return [];
    return [{ id: video.id, title: snippet.title, description: typeof snippet.description === 'string' ? snippet.description : '',
      publishedAt, image: thumbnail(snippet, video.id), url: `https://www.youtube.com/watch?v=${video.id}` }];
  }).sort((a, b) => b.publishedAt - a.publishedAt || ids.indexOf(a.id) - ids.indexOf(b.id));
  return { account: channel.id, items };
}

export async function notifyOfflineYouTube({ environment = process.env, rest, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const config = readOfflineYouTubeConfig(environment);
  if (!config) return { status: 'disabled' };
  rest ??= new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(config.token);
  await validateOfflineDestination(rest, config);
  const { account, items } = await youtubeUploads(config, { environment, fetchImpl, clock });
  if (!items.length) return { status: 'empty' };
  const history = await offlineMessageHistory(rest, config);
  const prefix = `VOIDTIDE • stream:youtube:${account}:`;
  const announced = new Set(history.flatMap((message) => (message.embeds ?? []).map((item) => item.footer?.text)
    .filter((text) => text?.startsWith(prefix)).map((text) => text.slice(prefix.length))));
  const checkpoint = items.findIndex((item) => announced.has(item.id));
  // First run (or beyond the 50-upload recovery window): share only the latest, never flood old uploads.
  const candidate = checkpoint < 0 ? items[0] : items.slice(0, checkpoint).reverse().find((item) => !announced.has(item.id));
  if (!candidate) return { status: 'duplicate' };
  if (platformCooldownActive(history, config, clock())) return { status: 'cooldown' };
  const key = `stream:youtube:${account}:${candidate.id}`;
  const description = candidate.description.trim().slice(0, 3800);
  const panel = new EmbedBuilder().setColor(0xff0033).setAuthor({ name: 'VOIDTIDE • YOUTUBE' })
    .setTitle(`▶️ ${candidate.title}`.slice(0, 256)).setURL(candidate.url)
    .setDescription(`${description ? `${description}\n\n` : ''}**[▶️ Watch on YouTube](${candidate.url})**`)
    .setImage(candidate.image).setTimestamp(candidate.publishedAt).setFooter({ text: `VOIDTIDE • ${key}` });
  await postOfflineAlert(rest, config, key, panel);
  return { status: 'posted' };
}
