import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { RulesError } from './rules-errors.js';

const { Administrator, ManageChannels, ManageRoles, ViewChannel } = PermissionFlagsBits;
const threadTypes = new Set([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

function hasView(bits) {
  // Do not let Administrator imply an explicit overwrite bit.
  return bits?.has(ViewChannel, false) ?? false;
}

function intentionalBypass(guild, overwrite, botMember) {
  if (overwrite.type === OverwriteType.Role) {
    const role = guild.roles.cache.get(overwrite.id);
    return Boolean(role?.permissions.has(Administrator) || role?.tags?.botId);
  }
  if (overwrite.type === OverwriteType.Member) {
    if (overwrite.id === botMember.id || overwrite.id === guild.ownerId) return true;
    const member = guild.members.cache.get(overwrite.id);
    // Guild Members is deliberately not enabled. Cached human role assignments
    // may be stale; only immutable bot identity is safe to use here. Current
    // administrators already bypass overwrites and do not need a member grant.
    return Boolean(member?.user?.bot);
  }
  return false;
}

/**
 * Inspect the complete channel snapshot before changing any permission.
 * The caller fetches channels and roles first and persists target IDs before applying.
 * Threads inherit their parent's visibility and are never edited directly.
 */
export async function buildPermissionPlan(guild, {
  rulesChannelId,
  verifiedRoleId,
  botMember,
  gatedChannelIds = [],
  channels = guild.channels.cache,
}) {
  if (!botMember?.id) throw new RulesError('The bot member could not be loaded. Try setup again.');
  if (guild.roles.everyone.permissions.has(Administrator)) {
    throw new RulesError('Remove Administrator from @everyone before setting up verification. That permission bypasses channel restrictions.');
  }

  const previousTargets = new Set(gatedChannelIds);
  const targets = [];
  const skippedPrivate = [];

  for (const channel of channels.values()) {
    if (!channel || channel.id === rulesChannelId || channel.isThread?.() || threadTypes.has(channel.type)) continue;
    const publicPermissions = channel.permissionsFor(guild.roles.everyone);
    if (!publicPermissions) {
      throw new RulesError(`Cannot inspect permissions for channel ${channel.id}. Check bot access before trying again.`);
    }

    const verifiedOverwrite = verifiedRoleId && channel.permissionOverwrites.cache.get(verifiedRoleId);
    const trackedGate = previousTargets.has(channel.id)
      && hasView(verifiedOverwrite?.allow)
      && !hasView(verifiedOverwrite?.deny);
    if (!publicPermissions.has(ViewChannel) && !trackedGate) {
      skippedPrivate.push(channel.id);
      continue;
    }

    const botPermissions = channel.permissionsFor(botMember);
    if (!botPermissions?.has([ViewChannel, ManageChannels, ManageRoles])) {
      throw new RulesError(`The bot needs View Channel, Manage Channels, and Manage Roles in channel ${channel.id}. No channel restrictions were applied.`);
    }

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.id === guild.id || overwrite.id === verifiedRoleId || !hasView(overwrite.allow)) continue;
      if (!intentionalBypass(guild, overwrite, botMember)) {
        throw new RulesError(`Channel ${channel.id} explicitly allows View Channel for ${overwrite.id}, which would bypass verification. Review that overwrite before setup; the bot will not remove it.`);
      }
    }

    targets.push(channel);
  }

  // Category changes can propagate to synced children. Snapshot every target first,
  // then apply child overwrites afterward so their own unrelated bits are preserved.
  targets.sort((left, right) => Number(right.type === ChannelType.GuildCategory)
    - Number(left.type === ChannelType.GuildCategory) || left.id.localeCompare(right.id));
  return { targets, skippedPrivate, botMemberId: botMember.id };
}

async function ensureView(channel, id, value, type, reason) {
  const overwrite = channel.permissionOverwrites.cache.get(id);
  if (value ? hasView(overwrite?.allow) && !hasView(overwrite?.deny)
    : hasView(overwrite?.deny) && !hasView(overwrite?.allow)) return;
  // edit() merges with the existing overwrite; set() would erase unrelated bits.
  await channel.permissionOverwrites.edit(id, { ViewChannel: value }, { type, reason });
}

/** Apply a validated plan sequentially through discord.js' rate-limited REST queue. */
export async function applyPermissionPlan(plan, { guild, verifiedRoleId, reason }) {
  if (!verifiedRoleId || !plan.botMemberId) {
    throw new RulesError('A Verified role and the bot member are required before applying verification restrictions.');
  }
  for (const channel of plan.targets) {
    // Keep a non-Administrator bot able to finish and maintain setup after gating.
    await ensureView(channel, plan.botMemberId, true, OverwriteType.Member, reason);
    await ensureView(channel, verifiedRoleId, true, OverwriteType.Role, reason);
    await ensureView(channel, guild.id, false, OverwriteType.Role, reason);
  }
}
