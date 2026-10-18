import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { STAFF_ROLES } from '../config/server-layout.js';
import { configFor, embed, sendOnce, textChannel, UserError, verified } from './management-utils.js';

export const TICKET_TYPES = ['General Help', 'Report Member', 'Technical Help', 'Partnership'];
export class TicketService {
  constructor(services) { Object.assign(this, services); }
  async panel(guild, config) {
    return sendOnce(this.store, await textChannel(guild, config.channels['open-ticket']), 'panel:tickets', {
      embeds: [embed('VOIDTIDE • Support', 'Choose a support category. Tickets are private to you and authorized staff. Do not post confidential information in public channels.')],
      components: [new ActionRowBuilder().addComponents(TICKET_TYPES.map((name, n) => new ButtonBuilder().setCustomId(`voidtide:ticket:${n}`).setLabel(name).setStyle(ButtonStyle.Primary)))],
    }, { edit: true });
  }
  async open(interaction, type) {
    const config = configFor(this.store, interaction.guildId); verified(interaction, config);
    if (!TICKET_TYPES.includes(type)) throw new UserError('Choose a valid support category.');
    if (interaction.isButton?.()) {
      const panel = this.store.get(interaction.guildId, 'deliveries', 'panel:tickets');
      if (panel?.messageId !== interaction.message.id || panel.channelId !== interaction.channelId) throw new UserError('Use the current support panel.');
    }
    return this.store.lock(`tickets:${interaction.guildId}`, async () => {
      let id = this.store.get(interaction.guildId, 'ticket-open', interaction.user.id)?.id;
      let ticket = id && this.store.get(interaction.guildId, 'tickets', id);
      const recent = this.store.list(interaction.guildId, 'tickets').filter(({ value }) => value.ownerId === interaction.user.id && Date.now() - value.createdAt < 3600_000);
      if (!ticket && recent.length >= 3) throw new UserError('Ticket creation is limited to three tickets per hour. Contact staff if needed.');
      const staffIds = STAFF_ROLES.map((name) => config.roles?.[name]).filter(Boolean);
      if (!config.categories?.SUPPORT || staffIds.length !== 3) throw new UserError('Ask an administrator to run /setup-server first.');
      if (!ticket) {
        id = randomUUID(); ticket = { id, ownerId: interaction.user.id, type, status: 'creating', createdAt: Date.now() };
        this.store.transaction(() => {
          this.store.set(interaction.guildId, 'tickets', id, ticket);
          this.store.set(interaction.guildId, 'ticket-open', interaction.user.id, { id });
        });
      }
      const channels = await interaction.guild.channels.fetch();
      const marker = `VOIDTIDE private ticket ${id}`;
      const matches = [...channels.values()].filter((channel) => channel.topic === marker);
      const savedChannel = ticket.channelId && channels.get(ticket.channelId);
      if (matches.length > 1 || (savedChannel && matches.some((channel) => channel.id !== savedChannel.id))) throw new UserError('Duplicate ticket recovery candidates exist. Contact an administrator.');
      if (ticket.channelId && !savedChannel) {
        this.store.transaction(() => {
          this.store.set(interaction.guildId, 'tickets', id, { ...ticket, status: 'deleted-externally' });
          this.store.delete(interaction.guildId, 'ticket-open', ticket.ownerId);
        });
        throw new UserError('Staff deleted your previous ticket channel. Its record is retained; run /ticket again to open a new ticket.');
      }
      const me = await interaction.guild.members.fetchMe({ force: true });
      if (!me.permissions.has([P.ManageChannels, P.ManageRoles])) throw new UserError('The bot needs Manage Channels and Manage Roles to create private tickets.');
      let channel = savedChannel ?? matches[0];
      if (channel) {
        const roles = await interaction.guild.roles.fetch();
        if (channel.type !== ChannelType.GuildText || channel.parentId !== config.categories.SUPPORT
          || channel.permissionsFor(interaction.guild.roles.everyone).has(P.ViewChannel)
          || channel.permissionsFor(roles.get(config.roles.Verified)).has(P.ViewChannel)) throw new UserError('Recovered ticket permissions are unsafe. An administrator must review them.');
        for (const overwrite of channel.permissionOverwrites.cache.values()) {
          if (overwrite.allow.has(P.ViewChannel, false) && ![ticket.ownerId, me.id, interaction.guild.ownerId, ...staffIds].includes(overwrite.id)
            && !roles.get(overwrite.id)?.permissions.has(P.Administrator)) throw new UserError('Recovered ticket has an unrelated visibility grant. Staff must fix its privacy before reuse.');
        }
      } else channel = await interaction.guild.channels.create({
        name: `ticket-${id.slice(0, 8)}`, type: ChannelType.GuildText, parent: config.categories.SUPPORT, topic: marker,
        permissionOverwrites: [
          { id: interaction.guildId, deny: [P.ViewChannel] },
          { id: config.roles.Verified, deny: [P.ViewChannel] },
          { id: interaction.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
          { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels, P.ManageRoles] },
          ...staffIds.map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
        ], reason: `Private support requested by ${interaction.user.id}`,
      });
      ticket = { ...ticket, channelId: channel.id, status: 'open' };
      this.store.set(interaction.guildId, 'tickets', id, ticket);
      await sendOnce(this.store, channel, `ticket-intro:${id}`, {
        embeds: [embed('VOIDTIDE • Private Support', `Category: **${ticket.type}**\nRequester: <@${interaction.user.id}>\nStaff will help here. Use the button or /close-ticket when resolved.`)],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`voidtide:close:${id}`).setLabel('Close ticket').setStyle(ButtonStyle.Danger))],
      });
      await this.log(interaction.guild, 'ticket-logs', `ticket-open:${id}`, 'Ticket opened', `Ticket: ${id}\nRequester ID: ${interaction.user.id}\nCategory: ${type}\nChannel: <#${channel.id}>\nNo ticket content is included in this log.`);
      return { content: `Your private ticket is <#${channel.id}>.` };
    });
  }
  async close(interaction, id) {
    return this.store.lock(`tickets:${interaction.guildId}`, async () => {
      const entry = id ? { key: id, value: this.store.get(interaction.guildId, 'tickets', id) }
        : this.store.list(interaction.guildId, 'tickets').find(({ value }) => value.channelId === interaction.channelId);
      const ticket = entry?.value;
      if (!ticket || ticket.channelId !== interaction.channelId) throw new UserError('Run this inside the ticket you want to close.');
      const config = configFor(this.store, interaction.guildId);
      const staff = interaction.memberPermissions?.has(P.ManageMessages) || STAFF_ROLES.some((name) => interaction.member?.roles.cache.has(config.roles?.[name]));
      if (ticket.ownerId !== interaction.user.id && !staff) throw new UserError('Only the requester or authorized staff can close this ticket.');
      if (ticket.status === 'closed') return { content: 'This ticket is already archived.' };
      const channel = await textChannel(interaction.guild, ticket.channelId);
      await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false, AddReactions: false, CreatePublicThreads: false, CreatePrivateThreads: false, SendMessagesInThreads: false }, { reason: 'Ticket archived without deleting messages' });
      await channel.setName(`closed-${ticket.id.slice(0, 8)}`, 'Ticket archived');
      this.store.transaction(() => {
        this.store.set(interaction.guildId, 'tickets', entry.key, { ...ticket, status: 'closed', closedAt: Date.now(), closedBy: interaction.user.id });
        this.store.delete(interaction.guildId, 'ticket-open', ticket.ownerId);
      });
      await this.log(interaction.guild, 'ticket-logs', `ticket-close:${ticket.id}`, 'Ticket archived', `Ticket: ${ticket.id}\nRequester ID: ${ticket.ownerId}\nClosed by: ${interaction.user.id}\nArchive: <#${channel.id}>\nMessages remain in the private archive; no transcript is posted publicly.`);
      return { content: 'Ticket archived read-only for the requester. Staff access and all existing messages are preserved.' };
    });
  }
}
