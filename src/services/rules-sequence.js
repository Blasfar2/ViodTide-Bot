import { RulesError } from './rules-errors.js';
import { RULES_AGREE_BUTTON_ID, RULES_PART_TITLES, RULES_FOOTER, rulesPartPayload } from './rules-payload.js';

const kinds = ['logo', 'body', 'agreement'];
const hasButton = (message) => message.components?.some((row) => row.components.some((button) => button.customId === RULES_AGREE_BUTTON_ID));

/** Recover all managed slots, then edit/send sequentially. Never delete messages. */
export async function publishRulesSequence({ channel, botId, state, store, logo }) {
  const managed = new Map(); const counts = new Map();
  const identify = (message) => {
    if (message.author?.id !== botId) return;
    const embed = message.embeds?.[0];
    const data = embed?.toJSON?.() ?? embed;
    const kind = Object.keys(RULES_PART_TITLES).find((kind) => data?.title === RULES_PART_TITLES[kind] && data?.footer?.text === RULES_FOOTER);
    if (!kind && !hasButton(message)) return;
    if (managed.has(message.id)) return;
    const label = hasButton(message) ? 'agreement' : kind;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (counts.get(label) > 1 || managed.size === 3) throw new RulesError('Duplicate VOIDTIDE rules messages exist. Ask an administrator to keep one rules sequence before retrying. No messages were deleted.');
    managed.set(message.id, message);
  };
  for (const id of new Set([state.rulesMessageId, ...Object.values(state.rulesSequence ?? {})].filter(Boolean))) {
    try {
      const message = await channel.messages.fetch({ message: id, force: true });
      if (message.author?.id !== botId) throw new RulesError('A saved rules message is not owned by this bot. Review the saved settings.');
      identify(message);
    } catch (error) { if (error.code !== 10008) throw error; }
  }
  let before;
  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    for (const message of page.values()) identify(message);
    if (page.size < 100) break;
    const next = [...page.values()].at(-1).id;
    if (before === next) throw new RulesError('Rules message recovery could not finish safely. Retry later.');
    before = next;
  }
  // Discord snowflake IDs sort chronologically. Comparing lengths also supports
  // test IDs without parsing arbitrary strings into numbers.
  const slots = [...managed.values()].sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const ids = {};
  // Persist intent before the first edit, including migration from a legacy panel.
  await store.set(channel.guild.id, { rulesLayout: 'split', rulesSequence: {} });
  for (const [index, kind] of kinds.entries()) {
    const payload = rulesPartPayload(kind, logo);
    const message = slots[index] ? await slots[index].edit(payload) : await channel.send(payload);
    ids[kind] = message.id;
    await store.set(channel.guild.id, { rulesSequence: { ...ids } });
  }
  return ids;
}
