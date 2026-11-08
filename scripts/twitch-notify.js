import { fileURLToPath, URL } from 'node:url';
import dotenv from 'dotenv';
import { ConfigError } from '../src/config/env.js';
import { UserError } from '../src/services/management-utils.js';
import { createLogger } from '../src/services/logger.js';
import { notifyOfflineTwitch } from '../src/services/offline-twitch.js';

const logger = createLogger();
try {
  const loaded = dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  if (loaded.error && loaded.error.code !== 'ENOENT') throw new ConfigError('Could not read the local .env file.');
  const { status } = await notifyOfflineTwitch();
  const messages = { disabled: 'Offline Twitch alerts are disabled. Enable only after configuring GitHub Actions secrets and variables.',
    offline: 'Twitch is offline. No alert sent.', duplicate: 'This stream was already announced. No duplicate sent.',
    cooldown: 'Twitch alert cooldown active. The next scheduled run can retry.', posted: 'Twitch live alert posted as VOIDTIDE Bot.' };
  logger.info(messages[status]);
} catch (error) {
  if (error instanceof ConfigError || error instanceof UserError) logger.error(error.message);
  else logger.error('Twitch notifier failed. Check Actions secrets, provider access and Discord channel permissions; request details are withheld.', error);
  process.exitCode = 1;
}
