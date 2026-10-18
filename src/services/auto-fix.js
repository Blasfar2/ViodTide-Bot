import { Buffer } from 'node:buffer';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { LAYOUT, STAFF_ROLES } from '../config/server-layout.js';
import { configFor, digest, requirePermission, UserError } from './management-utils.js';

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const category = (channel) => channel.type === ChannelType.GuildCategory;
const archiveName = (channel) => `${channel.name.slice(0, 65)}-archived-${channel.id}`;

function referencedChannels(value, channels, result) {
  if (typeof value === 'string' && channels.has(value)) result.add(value);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) referencedChannels(entry, channels, result);
}

async function editPermissions(channel, id, patch, reason) {
  const overwrite = channel.permissionOverwrites.cache.get(id);
  const changed = Object.entries(patch).some(([name, value]) => {
    const allow = overwrite?.allow.has(P[name], false) ?? false;
    const deny = overwrite?.deny.has(P[name], false) ?? false;
    return value === null ? allow || deny : value ? !allow || deny : !deny || allow;
  });
  if (changed) await channel.permissionOverwrites.edit(id, patch, { reason });
}

/** Repair only the known layout. Unrelated resources are never cleanup targets. */
export class AutoFix {
  constructor({ setup, store, rulesService }) {
    Object.assign(this, { setup, store, rulesService }); this.reviews = new Map();
  }

  async inspect(guild, deleteConflicts) {
    const rolePlan = await this.setup.inspect(guild, 'roles', {});
    if (guild.roles.everyone.permissions.has(P.Administrator)) throw new UserError('Remove Administrator from @everyone before auto-fix. It bypasses staff privacy and verification restrictions.');
    const channels = await guild.channels.fetch();
    const protectedIds = new Set([guild.rulesChannelId, guild.publicUpdatesChannelId, guild.systemChannelId, guild.safetyAlertsChannelId].filter(Boolean));
    referencedChannels(rolePlan.config, channels, protectedIds);
    referencedChannels(rolePlan.legacy, channels, protectedIds);
    for (const namespace of ['tickets', 'polls', 'streams', 'jobs', 'deliveries']) {
      referencedChannels(this.store.list(guild.id, namespace), channels, protectedIds);
    }
    const entries = []; const conflicts = new Map(); const claimed = new Set();
    const select = (name, group, type, savedId) => {
      const saved = channels.get(savedId);
      const matching = [...channels.values()].filter((c) => !c.isThread?.() && sameName(c.name, name)
        && category(c) === (type === ChannelType.GuildCategory)).sort((a, b) => a.id.localeCompare(b.id));
      const chosen = saved?.type === type ? saved : matching.find((c) => c.type === type);
      if (chosen && claimed.has(chosen.id)) throw new UserError(`The saved layout maps more than one resource to <#${chosen.id}>. Review those saved IDs before auto-fix.`);
      if (chosen) claimed.add(chosen.id);
      const candidates = [...matching];
      if (saved && saved !== chosen && !saved.isThread?.() && category(saved) === (type === ChannelType.GuildCategory)) candidates.push(saved);
      for (const channel of candidates) if (channel !== chosen) {
        const hasChildren = category(channel) && [...channels.values()].some((c) => c.parentId === channel.id);
        const canDelete = deleteConflicts && !protectedIds.has(channel.id) && !hasChildren;
        const alreadyArchived = channel.name.includes(`-archived-${channel.id}`);
        if (!alreadyArchived) conflicts.set(channel.id, { action: canDelete ? 'delete' : 'archive', id: channel.id,
          name: channel.name, type: ChannelType[channel.type], ...(canDelete ? {} : { to: archiveName(channel) }),
          reason: canDelete ? 'Conflicting layout resource; permanently deletes its history and threads' : hasChildren ? 'Preserve category and children' : protectedIds.has(channel.id) ? 'Referenced by saved settings; preserve its data' : 'Preserve conflicting resource and its messages' });
      }
      entries.push({ name, category: group, type, channel: chosen, staff: group === 'STAFF' });
    };
    for (const [group, names] of LAYOUT) {
      select(group, group, ChannelType.GuildCategory, rolePlan.config.categories?.[group]);
      for (const name of names) select(name, group, group === 'VOICE' ? ChannelType.GuildVoice : ChannelType.GuildText,
        name === '📜・rules' ? rolePlan.legacy.rulesChannelId ?? rolePlan.config.channels?.[name] : rolePlan.config.channels?.[name]);
    }
    for (const id of conflicts.keys()) if (claimed.has(id)) throw new UserError('A conflicting saved channel is also used elsewhere in the layout. Review the saved mappings before auto-fix.');
    const affected = new Set([...claimed, ...conflicts.keys()]);
    for (const id of affected) {
      const channel = channels.get(id);
      if (!channel.permissionsFor(rolePlan.me)?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) {
        throw new UserError(`The bot needs View Channel, Manage Channels and Manage Roles in <#${id}> before auto-fix. No repairs were applied.`);
      }
    }
    const actions = [...conflicts.values()];
    for (const entry of entries) {
      const channel = entry.channel;
      if (!channel) actions.push({ action: 'create', name: entry.name, type: ChannelType[entry.type], category: entry.category });
      else {
        if (channel.name !== entry.name) actions.push({ action: 'rename', id: channel.id, from: channel.name, to: entry.name });
        if (entry.type !== ChannelType.GuildCategory) {
          const parent = entries.find((e) => e.type === ChannelType.GuildCategory && e.name === entry.category)?.channel;
          if (channel.parentId !== parent?.id) actions.push({ action: 'move', id: channel.id, category: entry.category, preserveOverwrites: true });
        }
      }
    }
    const detail = { deleteConflicts, roles: rolePlan.plannedRoles.filter((r) => !r.role).map((r) => ({ name: r.name,
      permissions: r.permissions.map((bit) => Object.keys(P).find((name) => P[name] === bit)) })), actions,
      permissions: ['New non-staff community resources allow Verified and the bot; welcome and rules are public/read-only.',
        'STAFF category and its channels: deny View Channel to @everyone and Verified, allow the bot and Founder/Co-Founder/Moderator; remove unrelated explicit View Channel allows. Other permission bits stay unchanged.',
        'Moving existing channels keeps their own permission overwrites. Existing non-staff access is otherwise preserved; /auto-rule previews verification gates separately.'],
      staffResources: entries.filter((e) => e.staff).map((e) => ({ name: e.name, id: e.channel?.id ?? null,
        removeViewAllows: [...(e.channel?.permissionOverwrites.cache.values() ?? [])].filter((o) => o.allow.has(P.ViewChannel, false)
          && ![guild.ownerId, rolePlan.me.id, ...STAFF_ROLES.map((name) => rolePlan.plannedRoles.find((r) => r.name === name)?.role?.id)].includes(o.id)
          && !guild.roles.cache.get(o.id)?.permissions.has(P.Administrator)).map((o) => o.id) })),
      staffCategoryChildren: [...channels.values()].filter((c) => entries.some((e) => e.staff && e.type === ChannelType.GuildCategory && e.channel?.id === c.parentId))
        .map((c) => ({ id: c.id, name: c.name, synchronized: c.permissionsLocked, note: 'Synchronized children inherit the reviewed STAFF category restrictions.' })),
      unrelatedResourcesDeleted: false, historyWarning: 'A listed DELETE permanently removes the channel, all messages, and threads. Back up anything needed before confirming.' };
    return { ...rolePlan, plannedChannels: entries, detail, fingerprint: digest({ original: rolePlan.fingerprint, config: rolePlan.config, legacy: rolePlan.legacy, detail }) };
  }

  async run(interaction) {
    requirePermission(interaction);
    return this.store.lock(`setup:${interaction.guildId}`, () => this.rulesService.store.withGuildLock(interaction.guildId, async () => {
      const plan = await this.inspect(interaction.guild, interaction.options.getBoolean('delete_conflicts') === true);
      const key = `${interaction.guildId}:${interaction.user.id}`;
      if (interaction.options.getBoolean('confirm') !== true) {
        this.reviews.set(key, { hash: plan.fingerprint, expires: Date.now() + 600_000 });
        const count = (action) => plan.detail.actions.filter((a) => a.action === action).length;
        return { files: [{ attachment: Buffer.from(JSON.stringify(plan.detail, null, 2)), name: 'voidtide-auto-fix-preview.json' }], content:
          `**VOIDTIDE auto-fix preview**\nCreate: ${count('create')} categories/channels and ${plan.detail.roles.length} roles. Rename/move: ${count('rename') + count('move')}. Archive conflicts: ${count('archive')}. **Permanently DELETE: ${count('delete')}.**\nRead the attached exact resource IDs and permission changes. Deleted channels lose all history and threads. Unrelated resources are preserved.\nConfirm within 10 minutes using **/auto-fix confirm:true delete_conflicts:${plan.detail.deleteConflicts}**. Then use **/auto-rule** for rules and verification.` };
      }
      const review = this.reviews.get(key);
      if (!review || review.expires <= Date.now() || review.hash !== plan.fingerprint) throw new UserError('Run /auto-fix without confirm first and review the plan. Confirm with the same delete_conflicts option and administrator within 10 minutes; changed roles/channels/settings need a fresh preview.');
      this.reviews.delete(key);
      return this.apply(interaction, plan);
    }));
  }

  async apply(interaction, plan) {
    const guild = interaction.guild;
    const reason = `VOIDTIDE auto-fix confirmed by ${interaction.user.id}`;
    const auditId = interaction.id;
    const audit = { actorId: interaction.user.id, startedAt: Date.now(), status: 'applying', plan: plan.detail, completed: [] };
    const saveAudit = () => this.store.set(guild.id, 'repairs', auditId, audit);
    saveAudit();
    try {
      for (const action of plan.detail.actions.filter((a) => ['archive', 'delete', 'rename'].includes(a.action))) {
        const channel = await guild.channels.fetch(action.id);
        if (!channel) throw new UserError('A repair target changed. Run /auto-fix again to review the remaining changes.');
        audit.current = action; saveAudit();
        if (action.action === 'delete') {
          const current = await guild.channels.fetch();
          if (category(channel) && [...current.values()].some((c) => c.parentId === channel.id)) throw new UserError('A category gained children after the preview. Run a fresh /auto-fix preview.');
          await channel.delete(reason);
        } else await channel.setName(action.to, reason);
        audit.completed.push(action); audit.current = null; saveAudit();
      }
      await this.setup.apply(interaction, 'channels', {}, plan);
      const config = configFor(this.store, guild.id);
      for (const entry of plan.plannedChannels) {
        const id = entry.type === ChannelType.GuildCategory ? config.categories[entry.name] : config.channels[entry.name];
        const channel = await guild.channels.fetch(id);
        if (entry.type !== ChannelType.GuildCategory && channel.parentId !== config.categories[entry.category]) {
          await channel.setParent(config.categories[entry.category], { lockPermissions: false, reason });
        }
        if (entry.staff) {
          await editPermissions(channel, plan.me.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true, ManageRoles: true }, reason);
          await editPermissions(channel, guild.id, { ViewChannel: false }, reason);
          await editPermissions(channel, config.roles.Verified, { ViewChannel: false }, reason);
          const staffIds = STAFF_ROLES.map((name) => config.roles[name]);
          for (const id of staffIds) await editPermissions(channel, id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, reason);
          for (const overwrite of channel.permissionOverwrites.cache.values()) {
            if (overwrite.allow.has(P.ViewChannel, false) && ![guild.ownerId, plan.me.id, ...staffIds].includes(overwrite.id)
              && !guild.roles.cache.get(overwrite.id)?.permissions.has(P.Administrator)) await editPermissions(channel, overwrite.id, { ViewChannel: null }, reason);
          }
        }
      }
      const state = await this.rulesService.store.get(guild.id) ?? {};
      await this.rulesService.store.set(guild.id, { verifiedRoleId: config.roles.Verified, rulesChannelId: config.channels['📜・rules'],
        ...(state.rulesChannelId !== config.channels['📜・rules'] ? { rulesMessageId: null, complete: false } : {}),
        gatedChannelIds: [...new Set([...(state.gatedChannelIds ?? []), ...(config.managedGates ?? [])])],
        publicChannelIds: [...new Set([...(state.publicChannelIds ?? []), config.channels.welcome])] });
      audit.status = 'completed'; audit.finishedAt = Date.now(); saveAudit();
      return { content: 'VOIDTIDE layout repaired: missing categories/channels created, names and category placement corrected, staff access restricted, and reviewed conflicts archived/deleted. Saved IDs will be reused. Run **/auto-rule** to preview publishing the rules and I Agree verification. Other service panels remain managed by /setup-server.' };
    } catch (error) {
      audit.status = 'needs-review'; saveAudit();
      if (error instanceof UserError) throw error;
      throw new UserError('Auto-fix stopped before completing. Check bot permissions and connectivity, then run a fresh /auto-fix preview. Completed work and audit settings were saved; do not delete the data directory.');
    }
  }
}
