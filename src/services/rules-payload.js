import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { RULES_TEXT } from '../config/rules-text.js';

export const RULES_AGREE_BUTTON_ID = 'voidtide:rules:agree:v1';
export const RULES_CHANNEL_NAME = '📜・rules';
export const VERIFIED_ROLE_NAME = 'Verified';

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
