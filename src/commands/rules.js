import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { rulesPayload } from '../services/rules-payload.js';

export const rules = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Read the approved VOIDTIDE community rules.'),

  async execute(interaction) {
    await interaction.reply({ ...rulesPayload(), flags: MessageFlags.Ephemeral });
  },
};
