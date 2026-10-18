import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { rules } from '../src/commands/rules.js';
import { setupRules } from '../src/commands/setup-rules.js';
import { RULES_TEXT } from '../src/config/rules-text.js';
import { handleInteraction } from '../src/events/interaction-create.js';
import { RulesError } from '../src/services/rules-errors.js';
import { RULES_AGREE_BUTTON_ID, rulesPayload } from '../src/services/rules-payload.js';

const approvedRules = `🌌 VOIDTIDE | COMMUNITY RULES
Welcome to VOIDTIDE! 🌊
A community for gamers, streamers, friends, and everyone who loves having fun together.
Please follow these rules to keep VOIDTIDE safe, friendly, and welcoming.
01 | 🤝 Respect Everyone
Treat every member with kindness. No bullying, harassment, hate speech, discrimination, or personal attacks.
02 | 🤟 Accessibility & Inclusion
VOIDTIDE welcomes Deaf, hard-of-hearing, and hearing members. Respect sign languages, written communication, and different communication styles. Never mock someone's disability or communication method.
03 | 🚫 No Spam
Avoid flooding channels, repeated messages, excessive mentions, advertising, or unsolicited links.
04 | 🔞 Keep Content Appropriate
No NSFW content, explicit material, graphic violence, or illegal content.
05 | 🔒 Protect Privacy
Do not share personal information, private messages, photographs, or recordings of others without permission.
06 | 🎮 Fair Gaming
No cheating, scams, account theft, or sharing malicious downloads. Be respectful during games and competitions.
07 | 📢 No Unauthorized Advertising
Do not promote servers, social media, streams, or products without staff permission.
08 | 📺 Streaming & Clips
Respect streamers and creators. Do not deliberately disrupt streams or share other members' content without permission.
09 | 💬 Use the Correct Channels
Keep conversations relevant to each channel. Use support tickets when you need staff assistance.
10 | 🛡️ Follow Staff Instructions
Respect the moderation team. If you disagree with a decision, contact staff privately through a support ticket.
⚠️ Rule Violations
Depending on severity, violations may result in a warning, timeout, kick, or permanent ban.
✅ By participating in VOIDTIDE, you agree to follow these rules.
🌌 VOIDTIDE — Different Worlds, One Community. 🌊`;

function interaction(overrides = {}) {
  const calls = [];
  return {
    calls,
    user: { id: 'administrator' },
    guild: { id: 'guild' },
    guildId: 'guild',
    commandName: 'setup-rules',
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    options: { getBoolean: () => null },
    deferred: false,
    replied: false,
    isButton: () => false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    async deferReply(payload) { calls.push(['defer', payload]); this.deferred = true; },
    async editReply(payload) { calls.push(['edit', payload]); this.replied = true; },
    async reply(payload) { calls.push(['reply', payload]); this.replied = true; },
    async followUp(payload) { calls.push(['followUp', payload]); },
    ...overrides,
  };
}

test('approved rules retain every character and fit Discord embed limits', () => {
  assert.equal(RULES_TEXT, approvedRules);
  for (const verification of [false, true]) {
    const payload = rulesPayload({ verification });
    assert.equal(payload.embeds.length, 1);
    const embed = payload.embeds[0].toJSON();
    assert.equal(embed.description, approvedRules);
    assert.ok(embed.description.length <= 4096);
    assert.ok(payload.embeds[0].length <= 6000);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
});

test('verification panel has only Agree and ordinary rules reads have no buttons', () => {
  const payload = rulesPayload({ verification: true });
  assert.equal(payload.components.length, 1);
  const row = payload.components[0].toJSON();
  assert.equal(row.components.length, 1);
  assert.equal(row.components[0].custom_id, RULES_AGREE_BUTTON_ID);
  assert.equal(row.components[0].label, 'I Agree');
  assert.equal(row.components[0].emoji.name, '✅');
  assert.equal(row.components[0].style, ButtonStyle.Success);
  assert.deepEqual(rulesPayload().components, []);
});

test('/setup-rules has an Administrator default and an optional explicit confirmation', () => {
  const definition = setupRules.data.toJSON();
  assert.equal(definition.name, 'setup-rules');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(definition.options.length, 1);
  assert.equal(definition.options[0].name, 'confirm');
  assert.ok(!definition.options[0].required);
  assert.equal(rules.data.toJSON().default_member_permissions, undefined);
});

test('/setup-rules enforces Administrator at runtime before contacting services', async () => {
  for (const memberPermissions of [null, new PermissionsBitField()]) {
    const request = interaction({ memberPermissions });
    const rulesService = {
      async preview() { assert.fail('unauthorized preview'); },
      async setup() { assert.fail('unauthorized setup'); },
    };
    await assert.rejects(setupRules.execute(request, { rulesService }), (error) => {
      assert.ok(error instanceof RulesError);
      assert.match(error.message, /administrators/);
      return true;
    });
    assert.deepEqual(request.calls, []);
  }
});

test('/setup-rules previews by default and applies only confirm:true after a private acknowledgement', async () => {
  for (const confirm of [null, false, true]) {
    const request = interaction({ options: { getBoolean: (name) => {
      assert.equal(name, 'confirm');
      return confirm;
    } } });
    const serviceCalls = [];
    const rulesService = Object.fromEntries(['preview', 'setup'].map((method) => [method, async (...args) => {
      assert.equal(request.deferred, true, 'Discord is acknowledged before potentially slow setup');
      serviceCalls.push([method, ...args]);
      return 'Safe result';
    }]));
    await setupRules.execute(request, { rulesService });
    assert.deepEqual(serviceCalls, [[confirm === true ? 'setup' : 'preview', request.guild, request.user.id]]);
    assert.deepEqual(request.calls, [
      ['defer', { flags: MessageFlags.Ephemeral }],
      ['edit', { content: 'Safe result', allowedMentions: { parse: [] } }],
    ]);
  }
});

test('/rules is available to ordinary members and responds privately with the approved text', async () => {
  const request = interaction({ memberPermissions: new PermissionsBitField() });
  await rules.execute(request);
  assert.equal(request.calls.length, 1);
  const [method, payload] = request.calls[0];
  assert.equal(method, 'reply');
  assert.equal(payload.flags, MessageFlags.Ephemeral);
  assert.equal(payload.embeds[0].toJSON().description, approvedRules);
  assert.deepEqual(payload.components, []);
});

test('only the stable verification button is routed, and its response is private', async () => {
  for (const customId of [RULES_AGREE_BUTTON_ID, 'unrelated-button']) {
    const request = interaction({ isButton: () => true, isChatInputCommand: () => false, customId });
    let verificationCalls = 0;
    await handleInteraction(request, {
      commands: new Map(), guildId: 'guild', logger: { error: () => assert.fail('unexpected error') },
      rulesService: { async verify(received) {
        assert.equal(received, request);
        assert.equal(received.deferred, true);
        verificationCalls++;
        return 'You are verified.';
      } },
    });
    assert.equal(verificationCalls, Number(customId === RULES_AGREE_BUTTON_ID));
    if (verificationCalls) {
      assert.deepEqual(request.calls, [
        ['defer', { flags: MessageFlags.Ephemeral }],
        ['edit', { content: 'You are verified.', allowedMentions: { parse: [] } }],
      ]);
    } else assert.deepEqual(request.calls, []);
  }
});

test('verification outside the configured guild never reaches the service', async () => {
  for (const overrides of [{ guildId: 'other' }, { inGuild: () => false, guildId: null }]) {
    const request = interaction({ isButton: () => true, isChatInputCommand: () => false,
      customId: RULES_AGREE_BUTTON_ID, ...overrides });
    await handleInteraction(request, {
      commands: new Map(), guildId: 'guild', logger: { error: () => assert.fail('unexpected error') },
      rulesService: { verify: () => assert.fail('unexpected verification') },
    });
    assert.equal(request.calls[0][0], 'reply');
    assert.equal(request.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.match(request.calls[0][1].content, /different server/);
  }
});

test('retired Disagree buttons receive private guidance without verification or role changes', async () => {
  const request = interaction({ isButton: () => true, isChatInputCommand: () => false, customId: 'voidtide:rules:disagree:v1' });
  await handleInteraction(request, {
    commands: new Map(), guildId: 'guild', logger: { error: () => assert.fail('unexpected error') },
    rulesService: {
      verify() { assert.fail('Disagree must not verify'); },
    },
    management: { afterVerify() { assert.fail('Disagree must not clean up newcomer roles'); } },
  });
  assert.equal(request.calls[0][0], 'reply');
  assert.equal(request.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(request.calls[0][1].content, /Disagree was removed/);
  const foreign = interaction({ isButton: () => true, isChatInputCommand: () => false, customId: 'voidtide:rules:disagree:v1', guildId: 'another-guild' });
  await handleInteraction(foreign, { commands: new Map(), guildId: 'guild', logger: { error: () => assert.fail('unexpected error') },
    rulesService: { disagree() { assert.fail('Foreign guild must not reach rules service'); } } });
  assert.equal(foreign.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('safe RulesError guidance is returned while arbitrary error text stays private', async () => {
  for (const error of [new RulesError('Ask an administrator to repair the Verified role.'), new Error('private simulated request body')]) {
    const request = interaction({ isButton: () => true, isChatInputCommand: () => false,
      customId: RULES_AGREE_BUTTON_ID });
    const logged = [];
    await handleInteraction(request, {
      commands: new Map(), guildId: 'guild', logger: { error: (...args) => logged.push(args) },
      rulesService: { async verify() { throw error; } },
    });
    assert.equal(logged.length, 1);
    assert.equal(request.calls[1][0], 'edit');
    assert.equal(request.calls[1][1].content, error instanceof RulesError ? error.message
      : 'Something went wrong while running this command. Please try again.');
  }
});

test('verification remains successful when optional newcomer-label cleanup needs staff review', async () => {
  const request = interaction({ isButton: () => true, isChatInputCommand: () => false, customId: RULES_AGREE_BUTTON_ID });
  const logged = [];
  await handleInteraction(request, {
    commands: new Map(), guildId: 'guild', logger: { error: (...args) => logged.push(args) },
    rulesService: { async verify() { return 'You are verified.'; } },
    management: { run: (callback) => callback(), async afterVerify() { throw new RulesError('Unsafe newcomer role.'); } },
  });
  assert.match(request.calls[1][1].content, /You are verified/);
  assert.match(request.calls[1][1].content, /verification itself succeeded/);
  assert.equal(logged.length, 1);
});
