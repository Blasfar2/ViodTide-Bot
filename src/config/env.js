import { fileURLToPath, URL } from 'node:url';
import dotenv from 'dotenv';

const variableNames = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validate names without ever including configuration values in errors. */
export function readConfig(environment = process.env) {
  const missing = variableNames.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
  }

  for (const name of ['DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID']) {
    const value = environment[name].trim();
    if (!/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > 18446744073709551615n) {
      throw new ConfigError(`${name} must be a Discord ID copied with Developer Mode enabled.`);
    }
  }

  return Object.freeze({
    token: environment.DISCORD_TOKEN.trim(),
    clientId: environment.DISCORD_CLIENT_ID.trim(),
    guildId: environment.DISCORD_GUILD_ID.trim(),
  });
}

/** Existing process variables take precedence; .env resolves from the project root. */
export function loadConfig() {
  const result = dotenv.config({
    path: fileURLToPath(new URL('../../.env', import.meta.url)),
    quiet: true,
  });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new ConfigError('Could not read the project .env file. Check file access permissions.');
  }
  return readConfig();
}
