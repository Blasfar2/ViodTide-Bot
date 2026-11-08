import { fileURLToPath, URL } from 'node:url';
import dotenv from 'dotenv';
import { ConfigError } from '../src/config/env.js';
import { UserError } from '../src/services/management-utils.js';
import { createLogger } from '../src/services/logger.js';
import { notifyOfflineYouTube } from '../src/services/offline-youtube.js';

const logger = createLogger();
try {
  const loaded = dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (loaded.error && loaded.error.code !== 'ENOENT') throw new ConfigError('Could not read the local .env file.');
  const { status } = await notifyOfflineYouTube();
  const messages = { disabled: 'Offline YouTube alerts are disabled. Configure Actions secrets and variables before enabling.',
    empty: 'No published public YouTube videos found. Nothing sent.', duplicate: 'Latest YouTube uploads were already shared. No duplicate sent.',
    cooldown: 'YouTube alert cooldown active. The next scheduled run can retry.', posted: 'YouTube video shared as VOIDTIDE Bot.' };
  logger.info(messages[status]);
} catch (error) {
  if (error instanceof ConfigError || error instanceof UserError) logger.error(error.message);
  else logger.error('YouTube notifier failed. Check Actions secrets, API access and Discord permissions; request details are withheld.', error);
  process.exitCode = 1;
}
