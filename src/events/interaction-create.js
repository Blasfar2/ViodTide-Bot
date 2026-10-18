import { MessageFlags } from 'discord.js';

async function sendPrivateError(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInteraction(interaction, { commands, guildId, logger }) {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (!interaction.inGuild() || interaction.guildId !== guildId) {
      await sendPrivateError(interaction, 'This bot is configured for a different server.');
      return;
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      await sendPrivateError(interaction, 'This command is unavailable. Ask an administrator to refresh the bot commands.');
      return;
    }

    await command.execute(interaction);
  } catch (error) {
    logger.error('Could not complete a slash command.', error);
    try {
      if (interaction.deferred && !interaction.replied) {
        // Resolve the original deferred response instead of leaving it thinking forever.
        await interaction.editReply({ content: 'Something went wrong while running this command. Please try again.' });
      } else {
        await sendPrivateError(interaction, 'Something went wrong while running this command. Please try again.');
      }
    } catch (replyError) {
      logger.error('Could not send the command error response.', replyError);
    }
  }
}
