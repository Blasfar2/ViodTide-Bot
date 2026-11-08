import { URLSearchParams } from 'node:url';
import { ChannelType, EmbedBuilder, PermissionFlagsBits as P, PermissionsBitField, REST, Routes } from 'discord.js';
import { ConfigError, readConfig } from '../config/env.js';
import { digest, UserError } from './management-utils.js';
import { StreamService, validateStream } from './stream-service.js';

const maximumId = 18446744073709551615n;
function snowflake(environment, name) {
  const value = environment[name]?.trim() ?? '';
  if (!/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > maximumId) throw new ConfigError(`${name} must be a Discord ID copied with Developer Mode enabled.`);
  return value;
}

export function readOfflineTwitchConfig(environment = process.env) {
  if (!environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED || environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED === 'false') return null;
  if (environment.VOIDTIDE_OFFLINE_TWITCH_ENABLED !== 'true') throw new ConfigError('VOIDTIDE_OFFLINE_TWITCH_ENABLED must be true or false.');
  const discord = readConfig(environment);
  for (const name of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) if (!environment[name]?.trim()) throw new ConfigError(`Missing required environment variable: ${name}.`);
  const account = environment.TWITCH_LOGIN?.trim() || 'voidtideus'; validateStream('twitch', account);
  const minutes = environment.TWITCH_ALERT_COOLDOWN_MINUTES || '5';
  if (!/^\d{1,4}$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 1440) throw new ConfigError('TWITCH_ALERT_COOLDOWN_MINUTES must be an integer from 1 to 1440.');
  return { ...discord, account, channelId: snowflake(environment, 'TWITCH_LIVE_CHANNEL_ID'), roleId: snowflake(environment, 'TWITCH_NOTIFICATION_ROLE_ID'), cooldown: Number(minutes) * 60_000 };
}

/** Discord's role/everyone/member overwrite order, without opening a gateway session. */
function channelPermissions(config, channel, roles, member) {
  const assigned = new Set([config.guildId, ...member.roles]);
  let bits = roles.filter((role) => assigned.has(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if ((bits & P.Administrator) !== 0n) return new PermissionsBitField(PermissionsBitField.All);
  const overwrites = channel.permission_overwrites ?? [];
  const apply = (allow, deny) => { bits = (bits & ~deny) | allow; };
  const everyone = overwrites.find((overwrite) => overwrite.id === config.guildId);
  if (everyone) apply(BigInt(everyone.allow), BigInt(everyone.deny));
  const selected = overwrites.filter((overwrite) => Number(overwrite.type) === 0 && overwrite.id !== config.guildId && assigned.has(overwrite.id));
  apply(selected.reduce((bits, overwrite) => bits | BigInt(overwrite.allow), 0n), selected.reduce((bits, overwrite) => bits | BigInt(overwrite.deny), 0n));
  const own = overwrites.find((overwrite) => overwrite.id === config.clientId && Number(overwrite.type) === 1);
  if (own) apply(BigInt(own.allow), BigInt(own.deny));
  return new PermissionsBitField(bits);
}

async function validateDestination(rest, config) {
  const [me, channel, roles, channels, member] = await Promise.all([
    rest.get(Routes.user('@me')), rest.get(Routes.channel(config.channelId)), rest.get(Routes.guildRoles(config.guildId)),
    rest.get(Routes.guildChannels(config.guildId)), rest.get(Routes.guildMember(config.guildId, config.clientId)),
  ]);
  if (!me.bot || me.id !== config.clientId) throw new UserError('The Discord token must belong to the bot identified by DISCORD_CLIENT_ID.');
  if (channel.guild_id !== config.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new UserError('Choose an existing text/announcement channel in DISCORD_GUILD_ID.');
  const role = roles.find((role) => role.id === config.roleId);
  const highest = Math.max(...roles.filter((role) => member.roles.includes(role.id)).map((role) => role.position));
  if (!role || role.id === config.guildId || role.managed || BigInt(role.permissions) !== 0n || role.position >= highest
    || !/^(?:🟣\s*)?Twitch$/iu.test(role.name.normalize('NFKC').trim())) throw new UserError('TWITCH_NOTIFICATION_ROLE_ID must identify your nonprivileged Twitch opt-in role below the bot.');
  if (channels.some((item) => (item.permission_overwrites ?? []).some((overwrite) => overwrite.id === role.id && BigInt(overwrite.allow) !== 0n))) throw new UserError('The Twitch opt-in role has channel permission grants. Staff must review it; no permissions were changed.');
  const permissions = channelPermissions(config, channel, roles, member);
  if (!permissions.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory])) throw new UserError('The bot needs View Channel, Send Messages, Embed Links and Read Message History in the configured live channel.');
  if (!role.mentionable && !permissions.has(P.MentionEveryone)) throw new UserError('Pinging the Twitch opt-in role requires the bot to have Mention Everyone in this channel, or the role to be mentionable. Neither setting is changed automatically.');
}

async function findExistingAlert(rest, config, key, now) {
  const marker = `VOIDTIDE • ${key}`; let before; let cooldown = false;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const messages = await rest.get(Routes.channelMessages(config.channelId), { query: new URLSearchParams({ limit: '100', ...(before ? { before } : {}) }) });
    if (!Array.isArray(messages)) throw new UserError('Discord returned invalid message history. No alert was sent.');
    const owned = messages.filter((message) => message.author?.id === config.clientId);
    if (owned.some((message) => message.embeds?.some((item) => item.footer?.text === marker))) return 'duplicate';
    cooldown ||= owned.some((message) => now - Date.parse(message.timestamp) < config.cooldown
      && message.embeds?.some((item) => item.footer?.text?.startsWith('VOIDTIDE • stream:twitch:')));
    if (messages.length < 100) return cooldown ? 'cooldown' : null;
    const next = messages.at(-1)?.id;
    if (!next || next === before) throw new UserError('Discord history pagination did not advance. No alert was sent.');
    before = next;
  }
  throw new UserError('Alert history exceeds 10,000 messages. Use a dedicated live channel or review history recovery before enabling alerts. No alert was sent.');
}

/** One scheduled REST check. No Client.login(), gateway, local SQLite or webhook required. */
export async function notifyOfflineTwitch({ environment = process.env, rest, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const config = readOfflineTwitchConfig(environment);
  if (!config) return { status: 'disabled' };
  rest ??= new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(config.token);
  await validateDestination(rest, config);
  const provider = new StreamService({ environment, fetchImpl, clock });
  const stream = await provider.twitch(config.account);
  if (!stream) return { status: 'offline' };
  if (typeof stream.id !== 'string' || !/^\d{1,40}$/.test(stream.id)) throw new UserError('Twitch returned an invalid stream ID. No alert was sent.');
  const key = `stream:twitch:${config.account}:${stream.id}`;
  const existing = await findExistingAlert(rest, config, key, clock());
  if (existing) return { status: existing };
  const panel = new EmbedBuilder().setColor(0x9146ff).setAuthor({ name: 'VOIDTIDE • LIVE NOW' })
    .setTitle(`🔴 ${stream.title}`.slice(0, 256)).setDescription(stream.description.slice(0, 4096)).setURL(`https://www.twitch.tv/${config.account}`)
    .setFooter({ text: `VOIDTIDE • ${key}` }).setTimestamp(clock());
  await rest.post(Routes.channelMessages(config.channelId), { body: { content: `<@&${config.roleId}>`, embeds: [panel.toJSON()],
    allowed_mentions: { parse: [], roles: [config.roleId], users: [], replied_user: false }, nonce: BigInt(`0x${digest(key).slice(0, 16)}`).toString(), enforce_nonce: true } });
  return { status: 'posted' };
}
