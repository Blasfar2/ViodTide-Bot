import { ChannelType, MessageFlags, PermissionFlagsBits as P, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../services/management-utils.js';
import { TICKET_TYPES } from '../services/ticket-service.js';

const definitions = [];
function command(name, description, permission) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  if (permission) data.setDefaultMemberPermissions(permission);
  definitions.push(data); return data;
}
function string(data, name, description, required = true, max = 1000) {
  return data.addStringOption((option) => option.setName(name).setDescription(description).setRequired(required).setMaxLength(max));
}
function user(data, name = 'member', required = true) {
  return data.addUserOption((option) => option.setName(name).setDescription('Select a Discord member by account, never by display-name matching').setRequired(required));
}
function channel(data) {
  return data.addChannelOption((option) => option.setName('channel').setDescription('Destination text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true));
}
function announcement(data) {
  string(data, 'title', 'Announcement title', true, 256); string(data, 'description', 'Announcement text', true, 4000);
  string(data, 'image', 'Optional HTTPS image URL', false); string(data, 'link', 'Optional HTTPS destination URL', false);
  return data;
}
for (const name of ['server', 'roles', 'channels']) {
  const data = command(`setup-${name}`, `Preview and confirm safe VOIDTIDE ${name} setup`, P.Administrator);
  data.addBooleanOption((o) => o.setName('confirm').setDescription('Apply a matching preview from the last ten minutes'));
  for (const person of ['badr', 'yacin', 'nisrine', 'mehdi']) user(data, person, false);
}
command('setup-status', 'Show configured services and missing saved resources', P.Administrator);
command('channel-status', 'Inspect configured channel IDs and readiness', P.Administrator);
announcement(command('announce', 'Publish a staff announcement without mass mentions', P.ManageMessages));
command('schedule-announcement', 'Manage persistent scheduled announcements', P.ManageMessages)
  .addSubcommand((sub) => { sub.setName('create').setDescription('Schedule an announcement'); string(sub, 'time', 'ISO time with timezone, such as 2027-01-20T20:00:00Z'); return announcement(sub); })
  .addSubcommand((sub) => sub.setName('list').setDescription('List scheduled announcement jobs'))
  .addSubcommand((sub) => { sub.setName('cancel').setDescription('Cancel a pending announcement'); return string(sub, 'id', 'Saved job ID'); });
user(command('rank', 'Read your rank or another member rank'), 'member', false);
command('leaderboard', 'Show the top ten community members by XP');
command('level-rewards', 'Show reward roles for levels 5, 10, 20, 30 and 50');
user(command('xp-admin', 'Set member XP and synchronize safe reward roles', P.Administrator))
  .addIntegerOption((o) => o.setName('xp').setDescription('New total XP').setRequired(true).setMinValue(0).setMaxValue(1_000_000_000));
command('ticket-panel', 'Publish or update the support panel', P.Administrator);
command('ticket', 'Open one private support ticket')
  .addStringOption((o) => o.setName('category').setDescription('Support category').setRequired(true).addChoices(...TICKET_TYPES.map((name) => ({ name, value: name }))));
command('close-ticket', 'Close and archive the current private ticket');
command('role-panel', 'Publish safe self-assignable member roles', P.Administrator);
for (const [name, permission] of [['warn', P.ModerateMembers], ['timeout', P.ModerateMembers], ['kick', P.KickMembers], ['ban', P.BanMembers]]) {
  const data = user(command(name, `Staff ${name} with permission and hierarchy checks`, permission));
  string(data, 'reason', 'Required staff audit reason', true, 400);
  if (name === 'timeout') data.addIntegerOption((o) => o.setName('minutes').setDescription('Timeout duration, maximum 28 days').setRequired(true).setMinValue(1).setMaxValue(40320));
}
user(command('warnings', 'Read a member warning history privately', P.ModerateMembers));
command('clear', 'Delete recent unpinned messages; preserve old messages', P.ManageMessages)
  .addIntegerOption((o) => o.setName('count').setDescription('Number of recent messages to inspect').setRequired(true).setMinValue(1).setMaxValue(100));
const poll = command('poll', 'Publish an interactive one-vote-per-member poll', P.ManageMessages);
string(poll, 'question', 'Poll question', true, 200); string(poll, 'options', '2–5 choices separated by |', true, 360); string(poll, 'closes', 'Closing ISO time including timezone');
const event = command('event', 'Create a Discord community event with text details', P.ManageEvents);
string(event, 'title', 'Event title', true, 100); string(event, 'description', 'Event description', true, 3000);
string(event, 'start', 'Start ISO time including timezone'); string(event, 'end', 'End ISO time including timezone'); string(event, 'location', 'Where members meet, available in text', true, 100);
command('stream-config', 'Configure Twitch and YouTube notification accounts', P.Administrator)
  .addSubcommand((sub) => {
    sub.setName('add').setDescription('Add or update an account');
    sub.addStringOption((o) => o.setName('provider').setDescription('Notification provider').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }));
    string(sub, 'account', 'Lowercase Twitch login or UC YouTube channel ID'); return channel(sub);
  })
  .addSubcommand((sub) => {
    sub.setName('remove').setDescription('Remove an account');
    sub.addStringOption((o) => o.setName('provider').setDescription('Provider').setRequired(true).addChoices({ name: 'Twitch', value: 'twitch' }, { name: 'YouTube', value: 'youtube' }));
    return string(sub, 'account', 'Configured account');
  })
  .addSubcommand((sub) => sub.setName('list').setDescription('Show accounts and credential presence without revealing values'));
command('welcome-config', 'Enable or disable welcome and goodbye messages', P.Administrator)
  .addBooleanOption((o) => o.setName('enabled').setDescription('Enable messages').setRequired(true))
  .addChannelOption((o) => o.setName('channel').setDescription('Optional welcome destination; review newcomer access').addChannelTypes(ChannelType.GuildText));
command('jobs', 'Show durable job status and failed deliveries', P.ManageMessages);

export const managementCommands = definitions.map((data) => ({
  data,
  async execute(interaction, { management }) {
    if (!management) throw new UserError('Enable the Discord Members and Message Content intents, set ENABLE_COMMUNITY=true in .env, and restart the bot to use community management.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await management.run(() => management.execute(interaction));
    await interaction.editReply({ ...result, allowedMentions: { parse: [] } });
  },
}));
