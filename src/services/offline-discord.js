import { URLSearchParams } from 'node:url';
import { ChannelType, PermissionFlagsBits as P, PermissionsBitField, Routes } from 'discord.js';
import { ConfigError } from '../config/env.js';
import { SOCIAL_ROLES } from '../config/profile.js';
import { digest, UserError } from './management-utils.js';

const maximumId = 18446744073709551615n;
export function snowflake(environment, name) {
  const value = environment[name]?.trim() ?? '';
  if (!/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > maximumId) throw new ConfigError(`${name} must be a Discord ID copied with Developer Mode enabled.`);
  return value;
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

export async function validateOfflineDestination(rest, config) {
  const [me, channel, roles, channels, member] = await Promise.all([
    rest.get(Routes.user('@me')), rest.get(Routes.channel(config.channelId)), rest.get(Routes.guildRoles(config.guildId)),
    rest.get(Routes.guildChannels(config.guildId)), rest.get(Routes.guildMember(config.guildId, config.clientId)),
  ]);
  if (!me.bot || me.id !== config.clientId) throw new UserError('The Discord token must belong to the bot identified by DISCORD_CLIENT_ID.');
  if (channel.guild_id !== config.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new UserError('Choose an existing text/announcement channel in DISCORD_GUILD_ID.');
  const role = roles.find((role) => role.id === config.roleId);
  const highest = Math.max(...roles.filter((role) => member.roles.includes(role.id)).map((role) => role.position));
  const choice = SOCIAL_ROLES.find((item) => item.key === config.provider);
  if (!choice) throw new UserError('Choose an approved notification platform.');
  const normalized = (name) => name.normalize('NFKC').replace(/\uFE0F/gu, '').trim().toLowerCase();
  const allowedNames = [choice.name, `${choice.emoji} ${choice.name}`, `${choice.emoji}${choice.name}`].map(normalized);
  if (!role || role.id === config.guildId || role.managed || BigInt(role.permissions) !== 0n || role.position >= highest
    || !allowedNames.includes(normalized(role.name))) throw new UserError(`The configured ${choice.name} notification role must be nonprivileged and below the bot.`);
  if (channels.some((item) => (item.permission_overwrites ?? []).some((overwrite) => overwrite.id === role.id && BigInt(overwrite.allow) !== 0n))) throw new UserError('The opt-in role has channel permission grants. Staff must review it; no permissions were changed.');
  const permissions = channelPermissions(config, channel, roles, member);
  if (!permissions.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory])) throw new UserError('The bot needs View Channel, Send Messages, Embed Links and Read Message History in the configured notification channel.');
  if (!role.mentionable && !permissions.has(P.MentionEveryone)) throw new UserError('Pinging the opt-in role requires the bot to have Mention Everyone in this channel, or the role to be mentionable. Neither setting is changed automatically.');
}

/** Bounded shared delivery record, restricted to messages actually authored by this bot. */
export async function offlineMessageHistory(rest, config, untilMarker) {
  const owned = []; let before;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const messages = await rest.get(Routes.channelMessages(config.channelId), { query: new URLSearchParams({ limit: '100', ...(before ? { before } : {}) }) });
    if (!Array.isArray(messages)) throw new UserError('Discord returned invalid message history. No alert was sent.');
    owned.push(...messages.filter((message) => message.author?.id === config.clientId));
    if (untilMarker && owned.some((message) => message.embeds?.some((item) => item.footer?.text === untilMarker))) return owned;
    if (messages.length < 100) return owned;
    const next = messages.at(-1)?.id;
    if (!next || next === before) throw new UserError('Discord history pagination did not advance. No alert was sent.');
    before = next;
  }
  throw new UserError('Alert history exceeds 10,000 messages. Use a dedicated notification channel or review history recovery. No alert was sent.');
}

export const messageHasMarker = (message, marker) => message.embeds?.some((item) => item.footer?.text === marker);
export const platformCooldownActive = (messages, config, now) => messages.some((message) => now - Date.parse(message.timestamp) < config.cooldown
  && message.embeds?.some((item) => item.footer?.text?.startsWith(`VOIDTIDE • stream:${config.provider}:`)));

export async function postOfflineAlert(rest, config, key, panel) {
  return rest.post(Routes.channelMessages(config.channelId), { body: { content: `<@&${config.roleId}>`, embeds: [panel.toJSON()],
    allowed_mentions: { parse: [], roles: [config.roleId], users: [], replied_user: false }, nonce: BigInt(`0x${digest(key).slice(0, 16)}`).toString(), enforce_nonce: true } });
}
