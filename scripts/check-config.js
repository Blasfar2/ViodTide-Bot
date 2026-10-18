import { ConfigError, loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/services/logger.js';

const logger = createLogger();

try {
  loadConfig();
  logger.info('Required configuration is present and Discord ID formats passed. No values were printed.');
  logger.info('This offline check does not test Discord authentication, installation, or permissions.');
} catch (error) {
  logger.error(error instanceof ConfigError
    ? error.message
    : 'Configuration check failed. Check the project .env file and required variable names.');
  process.exitCode = 1;
}
