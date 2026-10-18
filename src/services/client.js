import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from '../commands/index.js';
import { handleClientReady } from '../events/client-ready.js';
import { handleInteraction } from '../events/interaction-create.js';
import { RulesService } from './rules-service.js';
import { Management } from './management.js';

export function createBotClient({ config, logger, onFatal, communityEnabled = process.env.ENABLE_COMMUNITY === 'true', managementStore }) {
  const rulesService = new RulesService();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, ...(communityEnabled ? [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])],
    allowedMentions: { parse: [], repliedUser: false },
    rest: { timeout: 15_000, retries: 3 },
  });
  const management = communityEnabled ? new Management({ client, guildId: config.guildId, logger, rulesService, ...(managementStore ? { store: managementStore } : {}) }) : null;
  const destroy = client.destroy.bind(client);
  client.destroy = async () => {
    management?.stop();
    await destroy();
    if (management) await management.shutdown();
  };

  client.once(Events.ClientReady, (readyClient) => {
    handleClientReady(readyClient, { config, logger, onFatal });
    if (management && client.isReady() && readyClient.user.id === config.clientId && client.guilds.cache.has(config.guildId)) management.start();
  });
  client.on(Events.InteractionCreate, (interaction) => {
    // EventEmitter does not await async handlers; always handle rejections explicitly.
    void handleInteraction(interaction, { commands, guildId: config.guildId, logger, rulesService, management })
      .catch((error) => logger.error('Interaction handling failed.', error));
  });
  if (management) {
    client.on(Events.MessageCreate, (message) => {
      void management.run(() => management.message(message)).catch((error) => logger.error('Message processing failed.', error));
    });
    for (const [event, joined] of [[Events.GuildMemberAdd, true], [Events.GuildMemberRemove, false]]) {
      client.on(event, (member) => {
        void management.run(() => management.community.memberEvent(member, joined)).catch((error) => logger.error('Member notification failed.', error));
      });
    }
  }
  client.on(Events.Error, (error) => logger.error('Discord client error.', error));
  client.on(Events.ShardError, (error) => logger.error('Discord gateway connection error.', error));

  return client;
}
