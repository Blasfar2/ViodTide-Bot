import { Routes } from 'discord.js';
import { getCommandDefinitions } from '../commands/index.js';

/** Explicit deployment only: never run automatically on startup or on a timer. */
export async function registerCommands(rest, config) {
  return rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: getCommandDefinitions(),
  });
}
