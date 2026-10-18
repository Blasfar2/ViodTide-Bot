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

export async function handleInteraction(interaction, { commands, guildId, logger, rulesService, management }) {
  const verification = interaction.isButton?.() && interaction.customId === RULES_AGREE_BUTTON_ID;
  const retiredChoice = interaction.isButton?.() && interaction.customId === 'voidtide:rules:disagree:v1';
  const managedButton = interaction.isButton?.() && /^voidtide:(ticket|close|role|poll):/.test(interaction.customId);
  const profileInteraction = (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) && /^voidtide:(profile|manage):/.test(interaction.customId);
  if (!verification && !retiredChoice && !managedButton && !profileInteraction && !interaction.isChatInputCommand()) return;

  try {
    if (!interaction.inGuild() || interaction.guildId !== guildId) {
      await sendPrivateError(interaction, 'This bot is configured for a different server.');
      return;
    }

    if (retiredChoice) {
      await sendPrivateError(interaction, 'Disagree was removed. Use the current rules panel and ✅ I Agree if you accept the rules.');
      return;
    }
    if (profileInteraction) {
      if (!management) throw new RulesError('Community management is disabled. Ask staff to enable it in the bot configuration.');
      await management.run(() => management.profileAdmin.handle(interaction));
      return;
    }
    if (verification) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let content = await rulesService.verify(interaction);
      if (management) {
        try { await management.run(() => management.afterVerify(interaction)); }
        catch (error) {
          logger.error('Verification succeeded, but newcomer label cleanup needs staff review.', error);
          content += '\nStaff should review your Newcomer label; verification itself succeeded.';
        }
      }
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    if (managedButton) {
      if (!management) throw new RulesError('Community management is disabled. Ask staff to enable it in the bot configuration.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await management.run(() => management.button(interaction));
      await interaction.editReply({ ...result, allowedMentions: { parse: [] } });
      return;
    }

    const command = commands.get(interaction.commandName);
    if (!command) {
      await sendPrivateError(interaction, 'This command is unavailable. Ask an administrator to refresh the bot commands.');
      return;
    }

    await command.execute(interaction, { rulesService, management });
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
