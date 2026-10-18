import { MessageFlags, PermissionFlagsBits as P, SlashCommandBuilder } from 'discord.js';
import { RulesError } from '../services/rules-errors.js';
import { configFor } from '../services/management-utils.js';

export const autoRule = {
  data: new SlashCommandBuilder().setName('auto-rule')
    .setDescription('Publish approved VOIDTIDE rules and I Agree verification after permission preview')
    .setDefaultMemberPermissions(P.Administrator)
    .addBooleanOption((o) => o.setName('confirm').setDescription('Apply the rules permission preview you reviewed in the last ten minutes')),
  async execute(interaction, { rulesService, management }) {
    if (!interaction.memberPermissions?.has(P.Administrator)) throw new RulesError('Only server administrators can run /auto-rule.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const execute = async () => {
      if (interaction.options.getBoolean('confirm') !== true) {
        return (await rulesService.preview(interaction.guild, interaction.user.id)).replaceAll('/setup-rules', '/auto-rule');
      }
      const content = await rulesService.setup(interaction.guild, interaction.user.id);
      if (management) {
        const state = await rulesService.store.get(interaction.guildId);
        const config = configFor(management.store, interaction.guildId);
        management.store.set(interaction.guildId, 'config', 'server', { ...config,
          roles: { ...config.roles, Verified: state.verifiedRoleId },
          channels: { ...config.channels, '📜・rules': state.rulesChannelId } });
      }
      return content;
    };
    const content = management ? await management.run(() => management.store.lock(`setup:${interaction.guildId}`, execute)) : await execute();
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  },
};
