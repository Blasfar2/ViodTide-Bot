import { SlashCommandBuilder } from 'discord.js';

export const ping = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether VOIDTIDE Bot is online and responding.'),

  async execute(interaction) {
    const startedAt = Date.now();
    // Acknowledge first so the command stays within Discord's initial reply deadline.
    await interaction.deferReply();
    const acknowledgement = Math.max(0, Date.now() - startedAt);
    const heartbeat = interaction.client.ws.ping;
    const gateway = Number.isFinite(heartbeat) && heartbeat >= 0
      ? `${Math.round(heartbeat)} ms`
      : 'measuring';

    await interaction.editReply({
      content: `Pong! 🏓\nAcknowledgement: **${acknowledgement} ms**\nGateway heartbeat: **${gateway}**`,
    });
  },
};
