import { MessageFlags } from 'discord.js';
import { RulesError } from '../services/rules-errors.js';
import { RULES_AGREE_BUTTON_ID } from '../services/rules-payload.js';

async function sendPrivateError(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInteraction(interaction, { commands, guildId, logger, rulesService }) {
  const verification = interaction.isButton?.() && interaction.customId === RULES_AGREE_BUTTON_ID;
  if (!verification && !interaction.isChatInputCommand()) return;

  try {
    if (!interaction.inGuild() || interaction.guildId !== guildId) {
      await sendPrivateError(interaction, 'This bot is configured for a different server.');
      return;
    }

    if (verification) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const content = await rulesService.verify(interaction);
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      await sendPrivateError(interaction, 'This command is unavailable. Ask an administrator to refresh the bot commands.');
      return;
    }

    await command.execute(interaction, { rulesService });
  } catch (error) {
    logger.error('Could not complete a Discord interaction.', error);
    const content = error instanceof RulesError
      ? error.message
      : 'Something went wrong while running this command. Please try again.';
    try {
      if (interaction.deferred && !interaction.replied) {
        // Resolve the original deferred response instead of leaving it thinking forever.
        await interaction.editReply({ content });
      } else {
        await sendPrivateError(interaction, content);
      }
    } catch (replyError) {
      logger.error('Could not send the command error response.', replyError);
    }
  }
}
