import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { RULES_TEXT } from '../config/rules-text.js';

export const RULES_AGREE_BUTTON_ID = 'voidtide:rules:agree:v1';
export const RULES_CHANNEL_NAME = '📜・rules';
export const VERIFIED_ROLE_NAME = 'Verified';
export const RULES_FOOTER = 'VOIDTIDE • Different Worlds, One Community.';
export const RULES_MAIN_TEXT = RULES_TEXT.split('\n⚠️ Rule Violations\n')[0];
export const RULES_AGREEMENT_TEXT = RULES_TEXT.slice(RULES_MAIN_TEXT.length + 1);
export const RULES_PART_TITLES = { logo: 'VOIDTIDE • Logo', body: 'VOIDTIDE • Community Rules', agreement: 'VOIDTIDE • Agreement' };

export function rulesPartPayload(kind, { logoUrl, logoFile } = {}) {
  const embed = new EmbedBuilder().setColor(kind === 'agreement' ? 0x22c55e : 0x7c3aed)
    .setTitle(RULES_PART_TITLES[kind]).setFooter({ text: RULES_FOOTER });
  if (kind === 'logo') {
    if (logoFile) embed.setImage(`attachment://${logoFile.name}`);
    else if (logoUrl) embed.setImage(logoUrl);
    else throw new Error('A rules logo is required.');
  } else embed.setDescription(kind === 'body' ? RULES_MAIN_TEXT : RULES_AGREEMENT_TEXT);
  return { content: null, embeds: [embed], components: kind === 'agreement' ? rulesPayload({ verification: true }).components : [],
    allowedMentions: { parse: [] }, attachments: [], files: kind === 'logo' && logoFile ? [logoFile] : [] };
}

export function rulesPayload({ verification = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0x0891b2)
    .setTitle('VOIDTIDE • Community Rules')
    .setDescription(RULES_TEXT)
    .setFooter({ text: 'VOIDTIDE • Different Worlds, One Community.' });

  return {
    embeds: [embed],
    components: verification ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(RULES_AGREE_BUTTON_ID)
        .setLabel('I Agree')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
    )] : [],
    allowedMentions: { parse: [] },
  };
}
