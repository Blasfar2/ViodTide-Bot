const safeCodes = new Set([
  'TokenInvalid', 'DisallowedIntents', 'UsedDisallowedIntents',
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
]);

// @discordjs/ws emits these exact messages without a code. Translate only known
// messages; arbitrary error text can contain credentials or request payloads.
const gatewayMessages = new Map([
  ['Used disallowed intents', 4014],
  ['Used invalid intents', 4013],
  ['Authentication failed', 4004],
]);

function gatewayHint(code) {
  if ([4014, 'DisallowedIntents', 'UsedDisallowedIntents'].includes(code)) {
    return ' Discord rejected privileged intents. In Discord Developer Portal > your application > Bot > Privileged Gateway Intents, enable Server Members Intent and Message Content Intent, save changes, then restart. If approval is unavailable, set ENABLE_COMMUNITY=false to run the foundation commands.';
  }
  if ([4004, 'TokenInvalid'].includes(code)) {
    return ' Discord rejected the bot token. Update DISCORD_TOKEN securely in your local environment, then restart.';
  }
  if (code === 4013) {
    return ' Discord rejected the requested gateway intents. Check the client intent configuration.';
  }
  return '';
}

export function createLogger(output = console) {
  return {
    info(message) {
      output.info(`${new Date().toISOString()} INFO ${message}`);
    },
    error(message, error) {
      const code = error?.code ?? gatewayMessages.get(error?.message);
      const detail = (Number.isSafeInteger(code) || safeCodes.has(code))
        ? ` (code: ${code})`
        : '';
      // Discord errors can contain request bodies and auth headers. Do not dump them.
      output.error(`${new Date().toISOString()} ERROR ${message}${detail}${gatewayHint(code)}`);
    },
  };
}
