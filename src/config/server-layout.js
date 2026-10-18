import { PermissionFlagsBits as P } from 'discord.js';

export const SELF_ROLES = [
  { name: 'Gamer', emoji: '🎮', key: 'gamer' },
  { name: 'Live Notification', emoji: '🔴', key: 'live' },
  { name: 'Video Notification', emoji: '🎬', key: 'video' },
  { name: 'Sign Language', emoji: '🤟', key: 'sign-language' },
  { name: 'Events', emoji: '🏆', key: 'events' },
];
// Setup creates only nonprivileged member/reward roles. Staff manage their own roles.
export const ROLE_DEFINITIONS = [['Verified', []], ...[5, 10, 20, 30, 50].map((n) => [`Level ${n}`, []]), ...SELF_ROLES.map((r) => [r.name, []])];
export const LAYOUT = [
  ['📌 VOIDTIDE INFO', ['📜・rules', '📢・announcements', '🎭・choose-roles']],
  ["🎮 LET'S PLAY", ['💬・gaming-chat', '🎮・find-players', '📸・game-clips', '🏆・levels']],
  ['🔴 LIVE & STREAM', ['🔴・live-now', '📺・streams', '🎬・youtube-clips']],
  ['🔊 GAME ROOMS', ['🎧・Game Room 1', '🎧・Game Room 2', '🎧・Game Room 3']],
  ['🎫 HELP', ['🎫・support']],
  ['🔒 VOIDTIDE STAFF', ['🛡️・staff-chat', '📋・bot-logs']],
];
export const CATEGORY_KEYS = { '📌 VOIDTIDE INFO': 'START HERE', "🎮 LET'S PLAY": 'GAMING', '🔴 LIVE & STREAM': 'VOIDTIDE STREAMS', '🔊 GAME ROOMS': 'VOICE', '🎫 HELP': 'SUPPORT', '🔒 VOIDTIDE STAFF': 'STAFF' };
export const CHANNEL_KEYS = { '📜・rules': '📜・rules', '📢・announcements': 'announcements', '🎭・choose-roles': 'choose-roles',
  '💬・gaming-chat': 'gaming-chat', '🎮・find-players': 'looking-for-group', '📸・game-clips': 'clips', '🏆・levels': 'leaderboard',
  '🔴・live-now': 'live-now', '📺・streams': 'streams', '🎬・youtube-clips': 'youtube',
  '🎧・Game Room 1': 'Gaming Room 1', '🎧・Game Room 2': 'Gaming Room 2', '🎧・Game Room 3': 'Gaming Room 3',
  '🎫・support': 'open-ticket', '🛡️・staff-chat': 'staff-chat', '📋・bot-logs': 'bot-logs' };
export const READONLY = new Set(['📜・rules', 'announcements', 'choose-roles', 'leaderboard', 'live-now', 'youtube', 'open-ticket', 'bot-logs']);
export const STAFF_ROLES = ['VOIDTIDE Founder', 'Co-Founder', 'Moderator'];
const staffPermissions = [P.Administrator, P.ManageGuild, P.ManageChannels, P.ManageRoles, P.ModerateMembers, P.KickMembers, P.BanMembers, P.ManageMessages];
export const isStaffRole = (role) => Boolean(role && !role.managed && staffPermissions.some((permission) => role.permissions.has(permission, false)));
export const staffRoleIds = (roles, everyoneId) => [...roles.values()].filter((role) => role.id !== everyoneId && isStaffRole(role)).map((role) => role.id);
