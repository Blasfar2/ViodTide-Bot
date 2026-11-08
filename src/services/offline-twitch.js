import { EmbedBuilder, REST } from 'discord.js';
import { ConfigError, readConfig } from '../config/env.js';
import { UserError } from './management-utils.js';
import { StreamService, validateStream } from './stream-service.js';
import { messageHasMarker, offlineMessageHistory, platformCooldownActive, postOfflineAlert, snowflake, validateOfflineDestination } from './offline-discord.js';

export function readOfflineTwitchConfig(environment = process.env) {
  if (!environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED || environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED === 'false') return null;
  if (environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED !== 'true') throw new ConfigError('VOIDTIDE_OFFLINE_TWITCH_ENABLED must be true or false.');
  const discord = readConfig(environment);
  for (const name of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) if (!environment[name]?.trim()) throw new ConfigError(`Missing required environment variable: ${name}.`);
  const account = environment.TWITCH_LOGIN?.trim() || 'voidtideus'; validateStream('twitch', account);
  const minutes = environment.TWITCH_ALERT_COOLDOWN_MINUTES || '5';
  if (!/^\d{1,4}$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 1440) throw new ConfigError('TWITCH_ALERT_COOLDOWN_MINUTES must be an integer from 1 to 1440.');
  return { ...discord, provider: 'twitch', account, channelId: snowflake(environment, 'TWITCH_LIVE_CHANNEL_ID'), roleId: snowflake(environment, 'TWITCH_NOTIFICATION_ROLE_ID'), cooldown: Number(minutes) * 60_000 };
}

/** One scheduled REST check. No Client.login(), gateway, local SQLite or webhook required. */
export async function notifyOfflineTwitch({ environment = process.env, rest, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const config = readOfflineTwitchConfig(environment);
  if (!config) return { status: 'disabled' };
  rest ??= new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(config.token);
  await validateOfflineDestination(rest, config);
  const provider = new StreamService({ environment, fetchImpl, clock });
  const stream = await provider.twitch(config.account);
  if (!stream) return { status: 'offline' };
  if (typeof stream.id !== 'string' || !/^\d{1,40}$/.test(stream.id)) throw new UserError('Twitch returned an invalid stream ID. No alert was sent.');
  const key = `stream:twitch:${config.account}:${stream.id}`;
  const marker = `VOIDTIDE • ${key}`;
  const history = await offlineMessageHistory(rest, config, marker);
  if (history.some((message) => messageHasMarker(message, marker))) return { status: 'duplicate' };
  if (platformCooldownActive(history, config, clock())) return { status: 'cooldown' };
  const panel = new EmbedBuilder().setColor(0x9146ff).setAuthor({ name: 'VOIDTIDE • LIVE NOW' })
    .setTitle(`🔴 ${stream.title}`.slice(0, 256)).setDescription(stream.description.slice(0, 4096)).setURL(`https://www.twitch.tv/${config.account}`)
    .setFooter({ text: `VOIDTIDE • ${key}` }).setTimestamp(clock());
  await postOfflineAlert(rest, config, key, panel);
  return { status: 'posted' };
}
