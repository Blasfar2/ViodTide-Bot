import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { ping } from '../src/commands/ping.js';
import { ConfigError, readConfig } from '../src/config/env.js';
import { handleClientReady } from '../src/events/client-ready.js';
import { handleInteraction } from '../src/events/interaction-create.js';
import { createBotClient } from '../src/services/client.js';
import { createLogger } from '../src/services/logger.js';
import { registerCommands } from '../src/services/register-commands.js';

const config = Object.freeze({
  token: 'test-only-token',
  clientId: '123456789012345678',
  guildId: '234567890123456789',
});

function makeLogger() {
  const entries = [];
  return {
    entries,
    info: (...arguments_) => entries.push(['info', ...arguments_]),
    error: (...arguments_) => entries.push(['error', ...arguments_]),
  };
}

function makeInteraction(overrides = {}) {
  const calls = [];
  return {
    calls,
    commandName: 'ping',
    guildId: config.guildId,
    deferred: false,
    replied: false,
    client: { ws: { ping: 31.6 } },
    isChatInputCommand: () => true,
    inGuild: () => true,
    async deferReply() {
      calls.push(['defer']);
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(['edit', payload]);
      this.replied = true;
    },
    async reply(payload) {
      calls.push(['reply', payload]);
      this.replied = true;
    },
    async followUp(payload) {
      calls.push(['followUp', payload]);
    },
    ...overrides,
  };
}

function dispatch(interaction, commands = new Map([['ping', ping]]), logger = makeLogger()) {
  return handleInteraction(interaction, { commands, guildId: config.guildId, logger });
}

test('configuration trims valid values and returns an immutable configuration', () => {
  const result = readConfig({
    DISCORD_TOKEN: ` ${config.token} `,
    DISCORD_CLIENT_ID: ` ${config.clientId} `,
    DISCORD_GUILD_ID: ` ${config.guildId} `,
  });
  assert.deepEqual(result, config);
  assert.equal(Object.isFrozen(result), true);
});

test('configuration lists missing variable names without exposing supplied values', () => {
  assert.throws(() => readConfig({ DISCORD_TOKEN: config.token }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /DISCORD_CLIENT_ID/);
    assert.match(error.message, /DISCORD_GUILD_ID/);
    assert.doesNotMatch(error.message, /test-only-token/);
    return true;
  });
  assert.throws(() => readConfig({ DISCORD_TOKEN: ' ' }), /DISCORD_TOKEN/);
});

test('configuration rejects invalid Discord IDs without echoing the input', () => {
  for (const name of ['DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID']) {
    for (const invalid of ['secret-test-input', '123', '123456789012345678901', '18446744073709551616']) {
      assert.throws(() => readConfig({
        DISCORD_TOKEN: config.token,
        DISCORD_CLIENT_ID: config.clientId,
        DISCORD_GUILD_ID: config.guildId,
        [name]: invalid,
      }), (error) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, new RegExp(name));
        assert.equal(error.message.includes(invalid), false);
        assert.equal(error.message.includes(config.token), false);
        return true;
      });
    }
  }
});

test('/ping acknowledges before reporting response and gateway latency', async () => {
  let acknowledge;
  const interaction = makeInteraction({
    deferReply() {
      interaction.calls.push(['defer']);
      return new Promise((resolve) => { acknowledge = resolve; });
    },
  });
  const pending = ping.execute(interaction);
  assert.deepEqual(interaction.calls, [['defer']], 'no response edit until acknowledgement completes');
  acknowledge();
  await pending;
  assert.equal(interaction.calls[0][0], 'defer');
  assert.equal(interaction.calls[1][0], 'edit');
  assert.equal(interaction.calls.length, 2);
  assert.match(interaction.calls[1][1].content, /Pong!/);
  assert.match(interaction.calls[1][1].content, /Acknowledgement: \*\*\d+ ms\*\*/);
  assert.match(interaction.calls[1][1].content, /Gateway heartbeat: \*\*32 ms\*\*/);
});

test('/ping handles an unavailable gateway measurement', async () => {
  for (const heartbeat of [-1, NaN, Infinity]) {
    const interaction = makeInteraction({ client: { ws: { ping: heartbeat } } });
    await ping.execute(interaction);
    assert.match(interaction.calls[1][1].content, /Gateway heartbeat: \*\*measuring\*\*/);
  }
});

test('interaction routing ignores buttons and other non-command interactions', async () => {
  const interaction = makeInteraction({ isChatInputCommand: () => false });
  let executions = 0;
  await dispatch(interaction, new Map([['ping', { execute: () => executions++ }]]));
  assert.equal(executions, 0);
  assert.deepEqual(interaction.calls, []);
});

test('interaction routing executes a known command in the configured guild', async () => {
  const interaction = makeInteraction();
  let received;
  await dispatch(interaction, new Map([['ping', { execute: async (value) => { received = value; } }]]));
  assert.equal(received, interaction);
});

test('commands in DMs or another guild receive a private rejection', async () => {
  for (const overrides of [{ inGuild: () => false, guildId: null }, { guildId: '345678901234567890' }]) {
    const interaction = makeInteraction(overrides);
    let executed = false;
    await dispatch(interaction, new Map([['ping', { execute: () => { executed = true; } }]]));
    assert.equal(executed, false);
    assert.equal(interaction.calls[0][0], 'reply');
    assert.match(interaction.calls[0][1].content, /different server/);
    assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
  }
});

test('an unknown command provides a private command-refresh instruction', async () => {
  const interaction = makeInteraction({ commandName: 'removed-command' });
  await dispatch(interaction);
  assert.equal(interaction.calls[0][0], 'reply');
  assert.match(interaction.calls[0][1].content, /refresh the bot commands/);
  assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('command errors use the appropriate initial, deferred, or already-replied response', async () => {
  const cases = [
    { overrides: {}, method: 'reply' },
    { overrides: { deferred: true }, method: 'edit' },
    { overrides: { replied: true }, method: 'followUp' },
    { overrides: { deferred: true, replied: true }, method: 'followUp' },
  ];
  for (const { overrides, method } of cases) {
    const interaction = makeInteraction(overrides);
    const logger = makeLogger();
    const failure = new Error('test failure');
    await dispatch(interaction, new Map([['ping', { execute: async () => { throw failure; } }]]), logger);
    assert.equal(interaction.calls[0][0], method);
    assert.match(interaction.calls[0][1].content, /Something went wrong/);
    if (method !== 'edit') assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.equal(logger.entries.length, 1);
    assert.equal(logger.entries[0][2], failure);
  }
});

test('failed error responses are caught and logged without an unhandled rejection', async () => {
  const logger = makeLogger();
  const interaction = makeInteraction({
    async reply() { throw new Error('reply failed'); },
  });
  await assert.doesNotReject(dispatch(interaction, new Map([['ping', {
    async execute() { throw new Error('command failed'); },
  }]]), logger));
  assert.equal(logger.entries.length, 2);
  assert.match(logger.entries[1][1], /error response/);
});

test('registration retains /ping and sends the approved commands to this application and guild', async () => {
  const calls = [];
  const response = [{ id: 'test-command-id' }];
  const result = await registerCommands({
    async put(...arguments_) { calls.push(arguments_); return response; },
  }, config);
  assert.equal(result, response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `/applications/${config.clientId}/guilds/${config.guildId}/commands`);
  assert.deepEqual(calls[0][1].body.map((command) => command.name), ['ping', 'rules', 'setup-rules']);
  assert.equal(calls[0][1].body[0].name, 'ping');
  assert.match(calls[0][1].body[0].description, /VOIDTIDE Bot/);
});

test('readiness requires the configured application and guild', () => {
  for (const scenario of ['wrong-application', 'missing-guild', 'ready']) {
    const logger = makeLogger();
    let failures = 0;
    handleClientReady({
      user: { id: scenario === 'wrong-application' ? '345678901234567890' : config.clientId },
      guilds: { cache: new Map(scenario === 'missing-guild' ? [] : [[config.guildId, {}]]) },
    }, { config, logger, onFatal: () => failures++ });
    assert.equal(failures, scenario === 'ready' ? 0 : 1);
    assert.equal(logger.entries[0][0], scenario === 'ready' ? 'info' : 'error');
    assert.match(logger.entries[0][1], scenario === 'wrong-application'
      ? /DISCORD_CLIENT_ID/ : scenario === 'missing-guild' ? /DISCORD_GUILD_ID/ : /ready/);
  }
});

test('client uses the Guilds intent, disables automatic mentions, and wires events without login', async () => {
  const logger = makeLogger();
  let failures = 0;
  const client = createBotClient({ config, logger, onFatal: () => failures++ });
  try {
    assert.equal(client.options.intents.bitfield, GatewayIntentBits.Guilds);
    assert.deepEqual(client.options.allowedMentions, { parse: [], repliedUser: false });
    assert.equal(client.isReady(), false);
    const readyClient = { user: { id: config.clientId }, guilds: { cache: new Map([[config.guildId, {}]]) } };
    client.emit(Events.ClientReady, readyClient);
    client.emit(Events.ClientReady, readyClient);
    assert.equal(logger.entries.filter(([level]) => level === 'info').length, 1);
    assert.equal(failures, 0);
    const interaction = makeInteraction();
    client.emit(Events.InteractionCreate, interaction);
    await nextTurn();
    assert.match(interaction.calls[1][1].content, /Pong!/);
    client.emit(Events.Error, new Error('test client error'));
    client.emit(Events.ShardError, new Error('test shard error'));
    assert.equal(logger.entries.filter(([level]) => level === 'error').length, 2);
    client.emit(Events.InteractionCreate, {
      isChatInputCommand() { throw new Error('unexpected interaction failure'); },
    });
    await nextTurn();
    assert.equal(logger.entries.filter(([level]) => level === 'error').length, 3);
    assert.match(logger.entries.at(-1)[1], /Interaction handling failed/);
  } finally {
    await client.destroy();
  }
});

test('safe logging retains recognized codes and excludes error bodies, messages, and headers', () => {
  const lines = [];
  const logger = createLogger({ info: (line) => lines.push(line), error: (line) => lines.push(line) });
  logger.info('Test ready message.');
  logger.error('Request failed.', {
    code: 50013,
    message: 'private-test-message',
    stack: 'private-test-stack',
    requestBody: { token: config.token },
    headers: { Authorization: config.token },
  });
  logger.error('Login failed.', { code: 'TokenInvalid', message: config.token });
  logger.error('Unknown error.', { code: config.token, message: config.token });
  assert.match(lines[0], /INFO Test ready message/);
  assert.match(lines[1], /50013/);
  assert.match(lines[2], /TokenInvalid/);
  assert.equal(lines.some((line) => line.includes(config.token) || line.includes('private-test')), false);
});

function runNode(relativePath, arguments_ = []) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(relativePath, import.meta.url)), ...arguments_], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    // Explicit empty values also prevent dotenv from loading credentials from a local .env.
    env: { DISCORD_TOKEN: '', DISCORD_CLIENT_ID: '', DISCORD_GUILD_ID: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('command preview works without credentials and emits a valid /ping payload', () => {
  const result = runNode('../scripts/deploy-commands.js', ['--dry-run']);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const definitions = JSON.parse(result.stdout);
  assert.deepEqual(definitions.map((command) => command.name), ['ping', 'rules', 'setup-rules']);
  assert.equal(definitions[0].name, 'ping');
  assert.equal(result.stderr, '');
});

test('startup fails locally with actionable missing-variable names', () => {
  const result = runNode('../src/index.js');
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID']) {
    assert.ok(result.stderr.includes(name));
  }
  assert.doesNotMatch(result.stdout, /Connecting/);
  assert.doesNotMatch(result.stderr, /test-only-token/);
});
