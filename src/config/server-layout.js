import { PermissionFlagsBits as P } from 'discord.js';
export const ROLE_DEFINITIONS = [
  ['VOIDTIDE Founder', [P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageMessages, P.ManageEvents]],
  ['Co-Founder', [P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageMessages, P.ManageEvents]],
  ['Moderator', [P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageMessages, P.ManageEvents]],
  ['VOIDTIDE Bot', []], ['Streamer', []], ['VIP', []], ['Verified', []], ['Newcomer', []],
  ...[5, 10, 20, 30, 50].map((level) => [`Level ${level}`, []]),
];
export const LAYOUT = [
  ['START HERE', ['welcome', '📜・rules', 'announcements', 'choose-roles']],
  ['COMMUNITY', ['general', 'sign-language', 'media', 'bot-commands', 'events']],
  ['GAMING', ['gaming-chat', 'looking-for-group', 'leaderboard', 'level-rewards']],
  ['VOIDTIDE STREAMS', ['live-now', 'clips', 'youtube', 'stream-schedule']],
  ['SUPPORT', ['open-ticket', 'faq']],
  ['VOICE', ['Gaming Room 1', 'Gaming Room 2', 'AFK']],
  ['STAFF', ['staff-chat', 'mod-logs', 'ticket-logs', 'bot-admin']],
];
export const STAFF_ROLES = ['VOIDTIDE Founder', 'Co-Founder', 'Moderator'];
export const READONLY = new Set(['welcome', '📜・rules', 'announcements', 'choose-roles', 'leaderboard', 'level-rewards', 'live-now', 'youtube', 'stream-schedule', 'open-ticket', 'faq']);
