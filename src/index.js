import { ConfigError, loadConfig } from './config/env.js';
import { createBotClient } from './services/client.js';
import { createLogger } from './services/logger.js';

const logger = createLogger();
let client;
let stopping = false;

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  logger.info('Stopping VOIDTIDE Bot.');
  // Handles normal termination and startup failures without leaving sockets open.
  Promise.resolve(client?.destroy()).catch((error) => {
    logger.error('Could not close the Discord connection cleanly.', error);
    process.exitCode = 1;
  });
}

try {
  const config = loadConfig();
  client = createBotClient({ config, logger, onFatal: () => shutdown(1) });
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
  logger.info('Connecting VOIDTIDE Bot to Discord...');
  await client.login(config.token);
} catch (error) {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error('Bot startup failed. Check configuration, writable data storage, bot permissions, and network access.', error);
  }
  shutdown(1);
}
