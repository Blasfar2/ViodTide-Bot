import { REST } from 'discord.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { getCommandDefinitions } from '../src/commands/index.js';
import { createLogger } from '../src/services/logger.js';
import { registerCommands } from '../src/services/register-commands.js';

const logger = createLogger();

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument !== '--dry-run')) {
    throw new ConfigError('Usage: npm run deploy:commands [-- --dry-run]');
  }

  if (arguments_.includes('--dry-run')) {
    // Validate the actual discord.js builders without credentials or API requests.
    console.log(JSON.stringify(getCommandDefinitions(), null, 2));
  } else {
    const config = loadConfig();
    const rest = new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(config.token);
    logger.info('Registering server commands. This replaces this application\'s commands in DISCORD_GUILD_ID.');
    const registered = await registerCommands(rest, config);
    logger.info(`Registered ${registered.length} server command(s). Try /ping after starting the bot.`);
  }
} catch (error) {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error('Command registration failed. Check the reset token, IDs, bot installation, and network access.', error);
  }
  process.exitCode = 1;
}
