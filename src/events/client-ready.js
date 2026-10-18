export function handleClientReady(client, { config, logger, onFatal }) {
  if (client.user.id !== config.clientId) {
    logger.error('The token belongs to a different application. Check DISCORD_CLIENT_ID and DISCORD_TOKEN.');
    onFatal();
    return;
  }
  if (!client.guilds.cache.has(config.guildId)) {
    logger.error('The bot cannot see DISCORD_GUILD_ID. Check the server ID and invite the bot to that server.');
    onFatal();
    return;
  }
  logger.info('VOIDTIDE Bot is ready. Try /ping in the configured server.');
}
