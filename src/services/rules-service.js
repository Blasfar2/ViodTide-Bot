import { createHash } from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { RulesError } from './rules-errors.js';
import { applyPermissionPlan, buildPermissionPlan } from './rules-permissions.js';
import { RULES_AGREE_BUTTON_ID, RULES_CHANNEL_NAME, rulesPayload, VERIFIED_ROLE_NAME } from './rules-payload.js';
import { rulesStore } from './rules-store.js';

const requiredPermissions = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles,
];
const privilegedPermissions = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone, PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.MoveMembers,
];
const reason = 'VOIDTIDE rules and verification setup, confirmed by a server administrator';
const readOnlyRules = {
  ViewChannel: true, ReadMessageHistory: true, UseApplicationCommands: true,
  SendMessages: false, AddReactions: false, CreatePublicThreads: false,
  CreatePrivateThreads: false, SendMessagesInThreads: false,
};

function chooseResource(collection, savedId, name, type) {
  const candidates = [...collection.values()].filter((item) => item.name.toLowerCase() === name.toLowerCase());
  const saved = savedId ? collection.get(savedId) : null;
  if (candidates.length > 1 || (saved && candidates.some((item) => item.id !== saved.id))) {
    throw new RulesError(`More than one ${name} resource exists. An administrator must resolve the duplicates before setup.`);
  }
  const resource = saved ?? candidates[0];
  if (resource && (resource.name.toLowerCase() !== name.toLowerCase()
    || (type !== undefined && resource.type !== type))) {
    throw new RulesError(`The saved ${name} resource was renamed or has an incompatible type. Restore it before setup.`);
  }
  return resource ?? null;
}

function checkRole(role, botMember) {
  if (!role) return;
  if (role.managed || !role.editable || botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new RulesError('Move the bot role above Verified. Verified must be a normal role the bot can manage.');
  }
  if (privilegedPermissions.some((permission) => role.permissions.has(permission, false))) {
    throw new RulesError('Verified has staff or moderation permissions. Remove those permissions or use a dedicated Verified member role before setup.');
  }
}

function checkVerifiedAccess(guild, role, rulesChannelId, gatedChannelIds, channels = guild.channels.cache) {
  if (!role) return;
  const knownGates = new Set(gatedChannelIds);
  for (const channel of channels.values()) {
    if (channel.isThread?.()) continue;
    const overwrite = channel.permissionOverwrites?.cache.get(role.id);
    if (overwrite && privilegedPermissions.some((permission) => overwrite.allow.has(permission, false))) {
      throw new RulesError('Verified has a staff permission grant in a channel. Remove that grant before using this role for verification.');
    }
    if (channel.id === rulesChannelId || knownGates.has(channel.id)) continue;
    const publicAccess = channel.permissionsFor(guild.roles.everyone);
    const verifiedAccess = channel.permissionsFor(role);
    if (!publicAccess || !verifiedAccess) {
      throw new RulesError('Could not inspect existing Verified channel access. Check bot permissions before setup.');
    }
    if (!publicAccess.has(PermissionFlagsBits.ViewChannel)
      && verifiedAccess.has(PermissionFlagsBits.ViewChannel)) {
      throw new RulesError('Verified already grants access to a private channel. Remove that private-channel grant or use a dedicated safe Verified role before setup.');
    }
  }
}

function checkRulesChannel(channel, botMember, verifiedRoleId) {
  if (!channel) return;
  if (channel.nsfw) {
    throw new RulesError('The rules channel is age-restricted. An administrator must remove its age restriction so every newcomer can read the rules.');
  }
  if (!channel.permissionsFor(botMember)?.has(requiredPermissions)) {
    throw new RulesError('The bot needs View Channels, Send Messages, Embed Links, Read Message History, Manage Channels, and Manage Roles in the rules channel.');
  }
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if ([channel.guild.id, botMember.id, verifiedRoleId].includes(overwrite.id)) continue;
    const role = channel.guild.roles.cache.get(overwrite.id);
    if (role?.permissions.has(PermissionFlagsBits.Administrator) || role?.tags?.botId) continue;
    const blockedReading = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.UseApplicationCommands].some((permission) => overwrite.deny.has(permission));
    const allowedPosting = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.AddReactions].some((permission) => overwrite.allow.has(permission));
    if (blockedReading || allowedPosting) {
      throw new RulesError('The rules channel has conflicting member or role overwrites. Remove its visibility denies and non-staff posting grants before setup.');
    }
  }
}

function fingerprint({ roles, channels, role, channel, plan, botMember }) {
  const bitfield = (value) => value.bitfield.toString();
  const channelSnapshot = [...channels.values()].map((item) => [
    item.id, item.name, item.type, item.parentId,
    [...(item.permissionOverwrites?.cache.values() ?? [])].map((overwrite) => [
      overwrite.id, overwrite.type, bitfield(overwrite.allow), bitfield(overwrite.deny),
    ]).sort((a, b) => a[0].localeCompare(b[0])),
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  const roleSnapshot = [...roles.values()].map((item) => [
    item.id, item.name, item.position, bitfield(item.permissions),
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha256').update(JSON.stringify({
    channels: channelSnapshot, roles: roleSnapshot, roleId: role?.id, channelId: channel?.id,
    botRoles: [...botMember.roles.cache.keys()].sort(),
    targets: plan.targets.map((item) => item.id).sort(),
  })).digest('hex');
}

function isPanel(message, botId) {
  return message.author?.id === botId && message.components.some((row) =>
    row.components.some((component) => component.customId === RULES_AGREE_BUTTON_ID));
}

/** Search all history when recovering state; never post a second panel after a crash. */
async function findPanel(channel, savedId, botId) {
  const matches = new Map();
  if (savedId) {
    try {
      const saved = await channel.messages.fetch({ message: savedId, force: true });
      if (saved.author.id !== botId) {
        throw new RulesError('The saved rules message is not owned by this bot. Check persistent settings before setup.');
      }
      matches.set(saved.id, saved);
    } catch (error) {
      if (error.code !== 10008) throw error; // Only Unknown Message establishes deletion.
    }
  }

  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    for (const message of page.values()) {
      if (isPanel(message, botId)) matches.set(message.id, message);
    }
    if (matches.size > 1) {
      throw new RulesError('Multiple VOIDTIDE rules panels exist. Keep one panel and remove duplicates before setup.');
    }
    if (page.size < 100) break;
    const oldest = [...page.values()].at(-1).id;
    if (oldest === before) throw new RulesError('Rules history could not be checked safely. Retry setup later.');
    before = oldest;
  }
  return [...matches.values()][0] ?? null;
}

function safeOperationError(error) {
  if (error instanceof RulesError) return error;
  if ([50013, 50001].includes(error.code)) {
    return new RulesError('Discord denied access. Check the bot permissions and role hierarchy, then rerun /setup-rules to preview and retry. Any saved resources will be reused.');
  }
  return new RulesError('The rules operation could not finish. Check bot permissions, role hierarchy, and connectivity, then preview and retry. Saved resources will be reused; do not delete the state file.');
}

export class RulesService {
  constructor({ store = rulesStore, clock = Date.now } = {}) {
    this.store = store;
    this.clock = clock;
    this.reviews = new Map();
  }

  async inspect(guild) {
    const state = await this.store.get(guild.id) ?? {};
    const roles = await guild.roles.fetch();
    const channels = await guild.channels.fetch();
    const botMember = await guild.members.fetchMe({ force: true });
    if (!botMember.permissions.has(requiredPermissions)) {
      throw new RulesError('Grant the bot View Channels, Send Messages, Embed Links, Read Message History, Manage Channels, and Manage Roles before setup. Administrator is not required.');
    }
    const role = chooseResource(roles, state.verifiedRoleId, VERIFIED_ROLE_NAME);
    if (state.verifiedRoleId && !roles.has(state.verifiedRoleId) && state.gatedChannelIds?.length) {
      throw new RulesError('The saved Verified role was deleted while channel gates still exist. An administrator must recover the role mapping and channel grants from the backup instructions before setup can continue. No replacement role was created.');
    }
    const channel = chooseResource(channels, state.rulesChannelId, RULES_CHANNEL_NAME, ChannelType.GuildText);
    checkRole(role, botMember);
    checkVerifiedAccess(guild, role, channel?.id, state.gatedChannelIds ?? [], channels);
    checkRulesChannel(channel, botMember, role?.id);
    const plan = await buildPermissionPlan(guild, {
      rulesChannelId: channel?.id, verifiedRoleId: role?.id,
      botMember, gatedChannelIds: state.gatedChannelIds ?? [], channels,
    });
    return { guild, state, botMember, role, channel, plan, roles, channels };
  }

  async preview(guild, actorId) {
    return this.store.withGuildLock(guild.id, async () => {
      try {
        const inspection = await this.inspect(guild);
        this.reviews.set(`${guild.id}:${actorId}`, {
          fingerprint: fingerprint(inspection), expiresAt: this.clock() + 10 * 60_000,
        });
        const examples = inspection.plan.targets.slice(0, 12).map((channel) => `<#${channel.id}>`).join(', ');
        return [
          '**VOIDTIDE rules setup — permission preview**',
          `${inspection.role ? 'Reuse' : 'Create'} **Verified**; ${inspection.channel ? 'reuse' : 'create'} **${RULES_CHANNEL_NAME}** and one rules panel.`,
          `Gate **${inspection.plan.targets.length}** public channels/categories: deny @everyone View Channel; allow Verified and the bot to view them. Other permission bits stay as configured.`,
          examples ? `Targets (first 12): ${examples}` : 'No public channels need gating.',
          `Keep **${inspection.plan.skippedPrivate.length}** private channels/categories private. The rules channel stays public and read-only, with /rules and the agreement button available.`,
          'If the rules channel shares synchronized permissions with a gated category, move only the rules channel to the server root so it remains accessible.',
          '**Existing members without Verified will also lose access until they agree.** Administrators and managed bot roles may bypass verification. No existing member receives Verified automatically.',
          'New public channels need another setup run. Other private role access remains unchanged; do not auto-assign bypass roles to newcomers.',
          'Review these changes, then run **/setup-rules confirm:true** as this administrator within 10 minutes. Server permission changes require a fresh preview.',
        ].join('\n');
      } catch (error) {
        throw safeOperationError(error);
      }
    });
  }

  async setup(guild, actorId) {
    return this.store.withGuildLock(guild.id, async () => {
      try {
        const review = this.reviews.get(`${guild.id}:${actorId}`);
        if (!review || review.expiresAt <= this.clock()) {
          throw new RulesError('Run /setup-rules without confirm first. Review the permission changes, then confirm as the same administrator within 10 minutes.');
        }
        const inspection = await this.inspect(guild);
        if (review.fingerprint !== fingerprint(inspection)) {
          throw new RulesError('Server roles or permissions changed since the preview. Run /setup-rules again before confirming.');
        }
        this.reviews.delete(`${guild.id}:${actorId}`);
        let { role, channel } = inspection;
        const { botMember, plan } = inspection;

        if (!role) {
          role = await guild.roles.create({ name: VERIFIED_ROLE_NAME, permissions: [], reason });
          await this.store.set(guild.id, { verifiedRoleId: role.id, complete: false });
          checkRole(role, botMember);
        }
        if (!channel) {
          channel = await guild.channels.create({
            name: RULES_CHANNEL_NAME, type: ChannelType.GuildText, reason,
            topic: 'Read the VOIDTIDE community rules and press ✅ I Agree to verify.',
            permissionOverwrites: [
              { id: guild.id, allow: ['ViewChannel', 'ReadMessageHistory', 'UseApplicationCommands'], deny: ['SendMessages', 'AddReactions', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] },
              { id: botMember.id, allow: requiredPermissions },
            ],
          });
          await this.store.set(guild.id, { rulesChannelId: channel.id, verifiedRoleId: role.id, complete: false });
        }
        // Persist adopted resources as well as newly created ones before altering access.
        await this.store.set(guild.id, { rulesChannelId: channel.id, verifiedRoleId: role.id, complete: false });
        if (channel.permissionsLocked && plan.targets.some((target) => target.id === channel.parentId)) {
          await channel.setParent(null, { lockPermissions: false, reason });
        }
        await channel.permissionOverwrites.edit(botMember.id, {
          ViewChannel: true, ReadMessageHistory: true, SendMessages: true,
          EmbedLinks: true, ManageChannels: true, ManageRoles: true,
        }, { reason });
        await channel.permissionOverwrites.edit(guild.id, readOnlyRules, { reason });
        await channel.permissionOverwrites.edit(role.id, readOnlyRules, { reason });

        const state = await this.store.get(guild.id);
        let message = await findPanel(channel, state.rulesMessageId, botMember.id);
        if (message) {
          await message.edit({ ...rulesPayload({ verification: true }), content: null });
        } else {
          message = await channel.send(rulesPayload({ verification: true }));
        }
        // The panel and its IDs must be durable BEFORE anyone loses channel access.
        await this.store.set(guild.id, {
          rulesMessageId: message.id, gatedChannelIds: plan.targets.map((target) => target.id),
        });
        await applyPermissionPlan(plan, { guild, verifiedRoleId: role.id, reason });
        await this.store.set(guild.id, { complete: true });
        return `Rules are ready in <#${channel.id}>. Members can press **✅ I Agree** to receive **Verified**. Public-channel restrictions and panel settings have been saved. Run setup again when adding public channels.`;
      } catch (error) {
        throw safeOperationError(error);
      }
    });
  }

  async verify(interaction) {
    return this.store.withGuildLock(interaction.guild.id, async () => {
      try {
        const state = await this.store.get(interaction.guild.id);
        if (!state?.rulesMessageId || state.rulesChannelId !== interaction.channelId
          || state.rulesMessageId !== interaction.message.id) {
          throw new RulesError('This verification panel is inactive. Use the current rules channel or ask an administrator to rerun /setup-rules.');
        }
        // Refresh all roles and channels so a stale cache cannot grant an elevated reward.
        const roles = await interaction.guild.roles.fetch();
        const channels = await interaction.guild.channels.fetch();
        const role = roles.get(state.verifiedRoleId);
        if (!role) throw new RulesError('Verified is missing. Ask an administrator to rerun /setup-rules.');
        const botMember = await interaction.guild.members.fetchMe({ force: true });
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          throw new RulesError('The bot needs Manage Roles to verify members. Please contact an administrator.');
        }
        checkRole(role, botMember);
        checkVerifiedAccess(interaction.guild, role, state.rulesChannelId, state.gatedChannelIds ?? [], channels);
        // A single-member REST fetch needs no privileged Guild Members gateway intent.
        const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
        if (member.user.bot) throw new RulesError('Verification is available to community members, not bot accounts.');
        if (member.pending) throw new RulesError('Complete Discord membership screening before pressing I Agree.');
        if (member.roles.cache.has(role.id)) return 'You are already verified. Welcome to VOIDTIDE! 🌊';
        await member.roles.add(role.id, 'Member accepted the approved VOIDTIDE community rules');
        return 'You are verified! Welcome to VOIDTIDE. 🌊';
      } catch (error) {
        throw safeOperationError(error);
      }
    });
  }
}
