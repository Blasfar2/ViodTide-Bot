import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from '../commands/index.js';
import { handleClientReady } from '../events/client-ready.js';
import { handleInteraction } from '../events/interaction-create.js';
import { RulesService } from './rules-service.js';

export function createBotClient({ config, logger, onFatal }) {
  const rulesService = new RulesService();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [], repliedUser: false },
  });

  client.once(Events.ClientReady, (readyClient) => {
    handleClientReady(readyClient, { config, logger, onFatal });
  });
  client.on(Events.InteractionCreate, (interaction) => {
    // EventEmitter does not await async handlers; always handle rejections explicitly.
    void handleInteraction(interaction, { commands, guildId: config.guildId, logger, rulesService })
      .catch((error) => logger.error('Interaction handling failed.', error));
  });
  client.on(Events.Error, (error) => logger.error('Discord client error.', error));
  client.on(Events.ShardError, (error) => logger.error('Discord gateway connection error.', error));

  return client;
}
