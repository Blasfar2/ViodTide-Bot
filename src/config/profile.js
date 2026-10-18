import { SELF_ROLES } from './server-layout.js';

export const SOCIAL_ROLES = [
  { key: 'tiktok', name: 'TikTok', emoji: '🎵', automatic: false },
  { key: 'youtube', name: 'YouTube', emoji: '▶️', automatic: true },
  { key: 'x', name: 'X / Twitter', emoji: '𝕏', automatic: false },
  { key: 'instagram', name: 'Instagram', emoji: '📸', automatic: false },
  { key: 'twitch', name: 'Twitch', emoji: '🟣', automatic: true },
];
export const COUNTRY_ROLES = [
  ['ma', 'Morocco', '🇲🇦'], ['dz', 'Algeria', '🇩🇿'], ['tn', 'Tunisia', '🇹🇳'],
  ['eg', 'Egypt', '🇪🇬'], ['fr', 'France', '🇫🇷'], ['es', 'Spain', '🇪🇸'],
  ['gb', 'United Kingdom', '🇬🇧'], ['us', 'United States', '🇺🇸'], ['ca', 'Canada', '🇨🇦'],
  ['de', 'Germany', '🇩🇪'], ['be', 'Belgium', '🇧🇪'], ['sa', 'Saudi Arabia', '🇸🇦'],
  ['ae', 'United Arab Emirates', '🇦🇪'], ['other', 'Other Country', '🌍'],
].map(([key, label, emoji]) => ({ key, label, emoji, name: `${emoji} ${label}` }));
export const PROFILE_GROUPS = { community: SELF_ROLES, social: SOCIAL_ROLES, country: COUNTRY_ROLES };
export const PROFILE_LAYOUT = [
  ['🎭 CUSTOMIZE YOUR PROFILE', [
    ['choose-roles', '🎭・choose-your-roles'], ['notification-roles', '🔔・notification-roles'], ['choose-country', '🌍・choose-country'],
  ]],
  ['🔴 VOIDTIDE LIVE & SOCIALS', [
    ['live-now', '🔴・live-now'], ['social-youtube', '▶️・youtube'], ['tiktok', '🎵・tiktok'],
    ['instagram', '📸・instagram'], ['social-updates', '🌐・social-updates'],
  ]],
];
export const PANEL_KEYS = { community: 'panel:roles:v2', social: 'panel:profile:social:v1', country: 'panel:profile:country:v1' };
export const PANEL_CHANNELS = { community: 'choose-roles', social: 'notification-roles', country: 'choose-country' };
// Also reject misleading staff/bot names even when someone removed their permission bits.
export const forbiddenRoleName = (name) => /(?:founder|moderator|administrator|\badmin\b|\bstaff\b|\bbots?\b|voidtoid)/iu.test(name);
