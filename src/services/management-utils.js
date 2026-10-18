import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { EmbedBuilder, PermissionFlagsBits as P } from 'discord.js';
import { RulesError } from './rules-errors.js';

export class UserError extends RulesError {}
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const configFor = (store, guildId) => store.get(guildId, 'config', 'server') ?? {};
export function requirePermission(interaction, permission = P.Administrator) {
  if (!interaction.memberPermissions?.has(permission)) throw new UserError('You do not have permission to use this command.');
}
export function requireStaff(interaction) { requirePermission(interaction, P.ManageMessages); }
export function verified(interaction, config) {
  const id = config.roles?.Verified;
  if (interaction.memberPermissions?.has(P.Administrator)) return;
  if (!id || !interaction.member?.roles?.cache?.has(id)) throw new UserError('Read the rules and verify before using this feature.');
}
export function embed(title, description) {
  if (!title || title.length > 256 || !description || description.length > 4096) throw new UserError('Use a title up to 256 characters and a description up to 4096 characters.');
  return new EmbedBuilder().setColor(0x0891b2).setTitle(title).setDescription(description);
}
export function httpsURL(value) {
  if (!value) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new UserError('Use a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || value.length > 1000) throw new UserError('Use a public HTTPS URL without embedded credentials.');
  return url.toString();
}
export function futureTime(value, now = Date.now()) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value ?? '')) throw new UserError('Use an ISO timestamp with timezone, for example 2027-01-20T20:00:00Z.');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) throw new UserError('The scheduled calendar date is invalid.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < now + 10_000 || time > now + 366 * 86400_000) throw new UserError('Choose a time at least 10 seconds ahead and within one year.');
  return time;
}
export async function textChannel(guild, id, permissions = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]) {
  if (!id) throw new UserError('Run the administrator setup first to configure this channel.');
  const channel = await guild.channels.fetch(id, { force: true });
  const me = await guild.members.fetchMe({ force: true });
  if (!channel?.isTextBased() || channel.isThread?.() || !channel.permissionsFor(me)?.has(permissions)) throw new UserError('The configured channel is unavailable or the bot lacks its required channel permissions.');
  return channel;
}
export async function safeRole(guild, roleId, snapshot) {
  if (!roleId) throw new UserError('This member role is not configured. Ask staff to set up the panels.');
  const role = snapshot ? snapshot.roles.get(roleId) : await guild.roles.fetch(roleId, { force: true });
  const me = snapshot?.me ?? await guild.members.fetchMe({ force: true });
  if (!me.permissions.has(P.ManageRoles)) throw new UserError('The bot needs Manage Roles to assign or remove member roles.');
  if (!role || role.managed || !role.editable || me.roles.highest.comparePositionTo(role) <= 0 || role.permissions.bitfield !== 0n) throw new UserError('This member role must be below the bot, unmanaged, and have no server-wide privileges.');
  const channels = snapshot?.channels ?? await guild.channels.fetch();
  if ([...channels.values()].some((channel) => (channel.permissionOverwrites?.cache.get(roleId)?.allow.bitfield ?? 0n) !== 0n)) throw new UserError('This role has channel permission grants and cannot be self-assigned or used as an XP reward.');
  return role;
}

/** Recover a completed send after a lost response/restart before creating another message. */
export async function sendOnce(store, channel, key, payload, { edit = false } = {}) {
  return store.lock(`send:${channel.guild.id}:${key}`, async () => {
    const marker = `VOIDTIDE • ${key}`;
    const saved = store.get(channel.guild.id, 'deliveries', key);
    let message;
    if (saved?.channelId && saved.channelId !== channel.id) throw new UserError('A saved panel/delivery belongs to another channel. Review its configuration before moving it.');
    if (saved?.messageId) {
      try { message = await channel.messages.fetch({ message: saved.messageId, force: true }); }
      catch (error) { if (error.code !== 10008) throw error; }
    }
    if (!message && (saved || key.startsWith('panel:'))) {
      let before;
      for (;;) {
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        const found = [...page.values()].filter((item) => item.author.id === channel.client.user.id && item.embeds.some((item) => item.footer?.text === marker));
        if (found.length > 1) throw new UserError('Duplicate saved panels were found. An administrator must resolve them.');
        if (found.length) { message = found[0]; break; }
        if (page.size < 100) break;
        const next = [...page.values()].at(-1).id;
        if (next === before) throw new UserError('Message history recovery could not finish safely.');
        before = next;
      }
    }
    const body = { ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } };
    body.embeds = payload.embeds.map((item) => EmbedBuilder.from(item).setFooter({ text: marker }));
    if (message && message.author.id !== channel.client.user.id) throw new UserError('The saved message is not owned by this bot.');
    if (!message) {
      // Intent first: an uncertain API response is recoverable on the next attempt.
      store.set(channel.guild.id, 'deliveries', key, { channelId: channel.id, status: 'sending', createdAt: Date.now() });
      message = await channel.send({ ...body, nonce: BigInt(`0x${digest(key).slice(0, 16)}`).toString(), enforceNonce: true });
    } else if (edit) await message.edit(body);
    store.set(channel.guild.id, 'deliveries', key, { channelId: channel.id, messageId: message.id });
    return message;
  });
}
