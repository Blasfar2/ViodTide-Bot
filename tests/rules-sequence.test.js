import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ButtonStyle, PermissionFlagsBits as P } from 'discord.js';
import { RULES_TEXT } from '../src/config/rules-text.js';
import { RulesLogo } from '../src/services/rules-logo.js';
import { RulesService } from '../src/services/rules-service.js';
import { RULES_FOOTER, RULES_AGREE_BUTTON_ID, rulesPartPayload } from '../src/services/rules-payload.js';
import { fixture } from './helpers/community-fixture.js';
import { autoRule } from '../src/commands/auto-rule.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoUAAAAASUVORK5CYII=', 'base64');
const upload = { size: png.length, url: 'https://cdn.discordapp.com/attachments/123/456/voidtide.png?signature=test-only' };
async function split(f, options = {}) {
  await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split', ...options });
  await f.rulesService.setup(f.guild, f.owner.id);
  const state = await f.rulesService.store.get(f.guild.id);
  return { state, channel: f.guild.channels.cache.get(state.rulesChannelId) };
}
async function assetFixture(t, fetchImpl = async () => new globalThis.Response(png)) {
  const directory = await mkdtemp(join(tmpdir(), 'voidtide-rule-logo-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new RulesLogo({ directory, fetchImpl });
}

function plainText(message) {
  return message.embeds[0].description.replaceAll('*', '').replace(/\n{2,}/g, '\n');
}

test('three public messages preserve every approved character with only one styled Agree button', async (t) => {
  const f = await fixture(t); const { state, channel } = await split(f);
  const posts = [...channel.messages.cache.values()];
  assert.equal(posts.length, 3);
  assert.match(posts[0].embeds[0].image.url, /^https:\/\/cdn\.discordapp\.com\//);
  assert.equal(`${plainText(posts[1])}\n${plainText(posts[2])}`, RULES_TEXT);
  assert.equal(posts[1].embeds.length, 1);
  assert.equal([...posts[1].embeds[0].description.matchAll(/^\*\*\d{2} \| .+\*\*$/gm)].length, 10);
  assert.match(posts[1].embeds[0].description, /\n\n\*\*01 \| 🤝 Respect Everyone\*\*\nTreat every member/);
  assert.match(posts[2].embeds[0].description, /\n\n\*\*✅ By participating/);
  assert.ok(posts[1].embeds[0].description.length <= 4096);
  assert.deepEqual(posts.map((p) => p.components.length), [0, 0, 1]);
  assert.equal(posts[2].components[0].components[0].style, ButtonStyle.Success);
  assert.equal(posts[2].components[0].components[0].custom_id, RULES_AGREE_BUTTON_ID);
  assert.equal(posts[2].embeds[0].color, 0x22c55e);
  assert.equal(posts[2].embeds[0].footer.text, RULES_FOOTER);
  assert.equal(state.rulesMessageId, posts[2].id);
  assert.deepEqual(Object.values(state.rulesSequence), posts.map((p) => p.id));
});

test('legacy rules migrate into three messages without deleting old posts or unrelated conversation', async (t) => {
  const f = await fixture(t);
  await f.rulesService.preview(f.guild, f.owner.id); await f.rulesService.setup(f.guild, f.owner.id);
  const before = await f.rulesService.store.get(f.guild.id);
  const old = f.guild.channels.cache.get(before.rulesChannelId);
  const note = await old.send({ content: 'Staff note to preserve' });
  const { channel, state } = await split(f);
  assert.equal(state.rulesSequence.logo, before.rulesMessageId);
  assert.equal(channel.messages.cache.get(note.id).content, 'Staff note to preserve');
  assert.equal(channel.messages.cache.size, 4);
  await f.rulesService.preview(f.guild, f.owner.id); await f.rulesService.setup(f.guild, f.owner.id);
  assert.equal(channel.messages.cache.size, 4, 'later normal setup keeps the saved split layout');
  assert.equal(f.calls.some(([kind]) => kind === 'deleteChannel'), false);
});

test('partial send with a lost state write recovers existing messages before gating channels', async (t) => {
  const f = await fixture(t); const general = f.addChannel('general');
  const set = f.rulesService.store.set.bind(f.rulesService.store);
  f.rulesService.store.set = async (guild, patch) => {
    if (patch.rulesSequence?.body) throw new Error('simulated storage failure');
    return set(guild, patch);
  };
  await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' });
  await assert.rejects(f.rulesService.setup(f.guild, f.owner.id), /could not finish/);
  const state = await f.rulesService.store.get(f.guild.id);
  const channel = f.guild.channels.cache.get(state.rulesChannelId);
  assert.equal(channel.messages.cache.size, 2);
  assert.equal(general.permissionsFor(f.guild.roles.everyone).has(P.ViewChannel), true);
  f.rulesService.store.set = set;
  await split(f);
  assert.equal(channel.messages.cache.size, 3);
  assert.equal(general.permissionsFor(f.guild.roles.everyone).has(P.ViewChannel), false);
});

test('deleted middle post is repaired in chronological order without duplicate rules or a stale button', async (t) => {
  const f = await fixture(t); const { state, channel } = await split(f);
  channel.messages.cache.delete(state.rulesSequence.body);
  const updated = await split(f); const posts = [...channel.messages.cache.values()];
  assert.equal(posts.length, 3);
  assert.equal(`${plainText(posts[1])}\n${plainText(posts[2])}`, RULES_TEXT);
  assert.deepEqual(posts.map((p) => p.components.length), [0, 0, 1]);
  assert.notEqual(updated.state.rulesMessageId, state.rulesMessageId);
  await assert.rejects(f.rulesService.verify({ guild: f.guild, channelId: channel.id, message: { id: state.rulesMessageId } }), /inactive/);
});

test('lost sequence IDs recover from full channel history and duplicates fail safely', async (t) => {
  const f = await fixture(t); const { channel } = await split(f);
  for (let index = 0; index < 105; index++) await channel.send({ content: 'Unrelated retained post' });
  await f.rulesService.store.set(f.guild.id, { rulesSequence: {}, rulesMessageId: null });
  await split(f); assert.equal(channel.messages.cache.size, 108);
  await channel.send(rulesPartPayload('body'));
  await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' });
  await assert.rejects(f.rulesService.setup(f.guild, f.owner.id), /Duplicate VOIDTIDE rules messages/);
  assert.equal(channel.messages.cache.size, 109);
});

test('logo uploads are staged only for preview, saved locally and sent by the bot on confirmation', async (t) => {
  const f = await fixture(t); let downloads = 0;
  const logos = await assetFixture(t, async (_url, options) => { downloads++; assert.equal(options.redirect, 'error'); return new globalThis.Response(png); });
  f.rulesService.logos = logos;
  await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split', logo: upload });
  assert.equal(await f.rulesService.store.get(f.guild.id), null);
  assert.deepEqual(f.calls, []);
  await f.rulesService.setup(f.guild, f.owner.id);
  const state = await f.rulesService.store.get(f.guild.id);
  assert.equal(downloads, 1); assert.equal(JSON.stringify(state).includes('signature'), false);
  const channel = f.guild.channels.cache.get(state.rulesChannelId);
  const logo = channel.messages.cache.get(state.rulesSequence.logo);
  assert.equal(logo.embeds[0].image.url, 'attachment://voidtide-logo.png');
  assert.deepEqual(logo.files[0].attachment, png);
  assert.deepEqual(await readFile(logos.path(f.guild.id, state.rulesLogo)), png);
  f.rulesService = new RulesService({ store: f.rulesService.store, logos: new RulesLogo({ directory: logos.directory, fetchImpl: () => assert.fail('no download on reuse') }) });
  await split(f);
  assert.equal(channel.messages.cache.size, 3);
});

test('logo validation blocks external destinations, redirects, invalid formats and oversized uploads', async (t) => {
  let calls = 0; const logos = await assetFixture(t, async () => { calls++; return new globalThis.Response('not an image'); });
  for (const url of ['http://cdn.discordapp.com/attachments/a/b', 'https://example.com/logo.png', 'https://cdn.discordapp.com.evil.test/attachments/a/b', 'https://cdn.discordapp.com/api/test', 'https://user:secret@cdn.discordapp.com/attachments/a/b']) {
    await assert.rejects(logos.prepare({ ...upload, url }), /Discord-uploaded/);
  }
  await assert.rejects(logos.prepare({ ...upload, size: 6 * 1024 * 1024 }), /5 MiB/); assert.equal(calls, 0);
  await assert.rejects(logos.prepare(upload), /PNG, JPEG or WebP/);
  const redirect = await assetFixture(t, async () => new globalThis.Response(null, { status: 302, headers: { Location: 'https://example.com/' } }));
  await assert.rejects(redirect.prepare(upload), /Could not download/);
  const oversized = await assetFixture(t, async () => new globalThis.Response(Buffer.alloc(5 * 1024 * 1024 + 1)));
  await assert.rejects(oversized.prepare(upload), /5 MiB/);
});

test('a damaged saved logo fails safely and uploading it again repairs the asset', async (t) => {
  const logos = await assetFixture(t); const asset = await logos.prepare(upload);
  const saved = await logos.save('guild', asset); await writeFile(logos.path('guild', saved), 'damaged');
  await assert.rejects(logos.load('guild', saved), /missing or damaged/);
  await logos.save('guild', asset); assert.deepEqual((await logos.load('guild', saved)).attachment, png);
  await assert.rejects(logos.load('guild', { sha256: '../../test', format: 'png' }), /missing or damaged/);
});

test('split preview requires Attach Files before creating anything and fits a Discord reply', async (t) => {
  const f = await fixture(t);
  const text = await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' });
  assert.ok(text.length <= 2000);
  f.botRole.permissions.remove(P.AttachFiles);
  await assert.rejects(f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' }), /Attach Files/);
  assert.deepEqual(f.calls, []);
});

test('auto-rule accepts the logo during preview and confirmation reuses it without another upload', async (t) => {
  const f = await fixture(t); f.rulesService.logos = await assetFixture(t);
  const request = (confirm, logo) => {
    const interaction = f.interaction('auto-rule', { confirm });
    interaction.options.getAttachment = () => logo;
    interaction.deferReply = async () => {};
    interaction.editReply = async (payload) => { assert.ok(payload.content.length <= 2000); };
    return interaction;
  };
  const services = { rulesService: f.rulesService, management: f.management };
  await autoRule.execute(request(false, upload), services);
  await assert.rejects(autoRule.execute(request(true, upload), services), /confirm without attaching/);
  await autoRule.execute(request(true), services);
  const state = await f.rulesService.store.get(f.guild.id);
  assert.ok(state.rulesLogo.sha256);
  assert.equal(f.guild.channels.cache.get(state.rulesChannelId).messages.cache.size, 3);
});

test('changed rules settings invalidate a presentation preview before sending messages', async (t) => {
  const f = await fixture(t); await f.rulesService.preview(f.guild, f.owner.id, { layout: 'split' });
  await f.rulesService.store.set(f.guild.id, { rulesLayout: 'split', rulesSequence: {} });
  await assert.rejects(f.rulesService.setup(f.guild, f.owner.id), /rules settings changed since the preview/);
  assert.deepEqual(f.calls, []);
});
