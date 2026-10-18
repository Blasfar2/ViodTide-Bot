import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { RulesError } from '../services/rules-errors.js';

export const setupRules = {
  data: new SlashCommandBuilder()
    .setName('setup-rules')
    .setDescription('Preview or apply the VOIDTIDE rules and verification setup.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((option) => option
      .setName('confirm')
      .setDescription('Apply the permission plan you reviewed in the last 10 minutes.')),

  async execute(interaction, { rulesService }) {
    // Discord command visibility can be customized. Always enforce authorization here too.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      throw new RulesError('Only server administrators can run /setup-rules.');
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const confirmed = interaction.options.getBoolean('confirm') === true;
    const content = confirmed
      ? await rulesService.setup(interaction.guild, interaction.user.id)
      : await rulesService.preview(interaction.guild, interaction.user.id);
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  },
};
