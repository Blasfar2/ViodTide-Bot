import { ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, PermissionFlagsBits as P } from 'discord.js';
import { configFor, embed, futureTime, requirePermission, requireStaff, sendOnce, textChannel, UserError, verified } from './management-utils.js';

export function recordVote(store, guildId, id, userId, choice, now = Date.now()) {
  return store.transaction(() => {
    const poll = store.get(guildId, 'polls', id);
    if (!poll || poll.closed || now >= poll.closesAt || !Number.isInteger(choice) || choice < 0 || choice >= poll.options.length) throw new UserError('This poll is closed or the vote is invalid.');
    const votes = { ...poll.votes, [userId]: choice };
    store.set(guildId, 'polls', id, { ...poll, votes });
    return { changed: Object.hasOwn(poll.votes, userId) };
  });
}
export function pollResults(poll) {
  const counts = poll.options.map((_, index) => Object.values(poll.votes).filter((choice) => choice === index).length);
  return poll.options.map((name, index) => `${index + 1}. ${name} — **${counts[index]}** vote(s)`).join('\n');
}
export class PollService {
  constructor(services) { Object.assign(this, services); }
  async create(interaction) {
    requireStaff(interaction);
    const question = interaction.options.getString('question');
    const options = interaction.options.getString('options').split('|').map((item) => item.trim());
    if (options.length < 2 || options.length > 5 || options.some((item) => !item || item.length > 70) || new Set(options).size !== options.length) throw new UserError('Use 2–5 distinct choices separated by |, each at most 70 characters.');
    const id = interaction.id;
    const saved = this.store.get(interaction.guildId, 'polls', id);
    const poll = saved ?? { id, question, options, channelId: interaction.channelId, closesAt: futureTime(interaction.options.getString('closes')), votes: {}, closed: false, createdBy: interaction.user.id };
    this.store.set(interaction.guildId, 'polls', id, poll);
    const channel = await textChannel(interaction.guild, poll.channelId);
    const message = await sendOnce(this.store, channel, `poll:${id}`, {
      embeds: [embed(`Poll • ${question}`, `${options.map((name, n) => `${n + 1}. ${name}`).join('\n')}\nCloses <t:${Math.floor(poll.closesAt / 1000)}:R>. One vote per member; voting again changes your choice.`)],
      components: [new ActionRowBuilder().addComponents(options.map((name, n) => new ButtonBuilder().setCustomId(`voidtide:poll:${id}:${n}`).setLabel(name).setStyle(ButtonStyle.Primary)))],
    });
    this.store.set(interaction.guildId, 'polls', id, { ...poll, messageId: message.id });
    this.store.set(interaction.guildId, 'jobs', `poll:${id}`, { type: 'poll', pollId: id, runAt: poll.closesAt, status: 'pending', attempts: 0 });
    return { content: 'Poll published. Votes and its closing time survive restarts.' };
  }
  vote(interaction, id, choice) {
    verified(interaction, configFor(this.store, interaction.guildId));
    const poll = this.store.get(interaction.guildId, 'polls', id);
    if (poll?.channelId !== interaction.channelId || poll.messageId !== interaction.message.id) throw new UserError('Use the original poll message.');
    const result = recordVote(this.store, interaction.guildId, id, interaction.user.id, choice);
    return { content: result.changed ? 'Your vote was updated. You still have one vote.' : 'Your vote was recorded.' };
  }
  async close(guild, id) {
    let poll = this.store.get(guild.id, 'polls', id);
    if (!poll) throw new UserError('The saved poll no longer exists.');
    if (!poll.closed) { poll = { ...poll, closed: true }; this.store.set(guild.id, 'polls', id, poll); }
    const channel = await textChannel(guild, poll.channelId);
    await sendOnce(this.store, channel, `poll:${id}`, { embeds: [embed(`Poll results • ${poll.question}`, pollResults(poll))], components: [] }, { edit: true });
  }
  async event(interaction) {
    requirePermission(interaction, P.ManageEvents);
    const me = await interaction.guild.members.fetchMe({ force: true });
    if (!me.permissions.has(P.ManageEvents)) throw new UserError('The bot needs Manage Events for Discord scheduled events.');
    const start = futureTime(interaction.options.getString('start'));
    const end = futureTime(interaction.options.getString('end'));
    if (end <= start) throw new UserError('The event end must be after its start.');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const marker = `VOIDTIDE event ${interaction.id}`;
    const events = await interaction.guild.scheduledEvents.fetch();
    const matches = [...events.values()].filter((event) => event.description?.endsWith(marker));
    if (matches.length > 1) throw new UserError('Multiple matching scheduled events exist. Staff must review them.');
    const event = matches[0] ?? await interaction.guild.scheduledEvents.create({
      name: title, description: `${description}\n\n${marker}`, entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: interaction.options.getString('location') }, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      scheduledStartTime: new Date(start), scheduledEndTime: new Date(end), reason: `VOIDTIDE event by ${interaction.user.id}`,
    });
    const config = configFor(this.store, interaction.guildId);
    const channel = await textChannel(interaction.guild, config.channels?.events);
    await sendOnce(this.store, channel, marker, { embeds: [embed(`VOIDTIDE • ${title}`, `${description}\nStarts <t:${Math.floor(start / 1000)}:F>\n${event.url}`)] });
    if (config.channels?.announcements) await sendOnce(this.store, await textChannel(interaction.guild, config.channels.announcements), `${marker}:announcement`, {
      embeds: [embed(`VOIDTIDE event • ${title}`, `${description}\nStarts <t:${Math.floor(start / 1000)}:F>\n${event.url}`)],
    });
    this.store.set(interaction.guildId, 'events', interaction.id, { discordId: event.id, start, end, createdBy: interaction.user.id });
    return { content: `Event created: ${event.url}. Details are available in text.` };
  }
}
