# Interactive profile customization

Uses the existing Node.js 24 / discord.js v14 bot and SQLite database. No new dependencies, paid services or external subscriptions.

## Publish the panels

1. Update the branch in Codespaces, run `npm ci`, register commands with `npm run deploy:commands`, then run `npm start`. Keep `ENABLE_COMMUNITY=true` and your existing ignored `.env`.
2. Run **`/manage-server`** as an administrator and choose **⚙️ Setup Panels**. Preview makes no Discord changes.
3. Read the private JSON attachment: existing IDs, roles, names/parents, new-resource permissions and notification routing.
4. Click **Confirm** within ten minutes using the same administrator, or **Cancel**. Resource/configuration changes require a new preview. Unused previews survive restarts until expiry. Interrupted applications require a fresh preview.
5. Test all three panels with an ordinary account before using the live community.

| Category | Channels |
| --- | --- |
| 🎭 CUSTOMIZE YOUR PROFILE | 🎭・choose-your-roles, 🔔・notification-roles, 🌍・choose-country |
| 🔴 VOIDTIDE LIVE & SOCIALS | 🔴・live-now, ▶️・youtube, 🎵・tiktok, 📸・instagram, 🌐・social-updates |

Setup reuses the existing public community-role/live-now channels by saved ID and renames/moves them only as reviewed. The community panel is edited in place. All other resources and service records remain, including existing welcome/rules/gaming/support/levels/staff channels. No resources are deleted, no welcome/goodbye channels are created, and existing permission overwrites are never edited. Moves use `lockPermissions:false`. Private, ambiguous, unsafe or wrong-type existing targets stop setup for manual review.

The older `/setup-server` remains available for the base gaming layout. Once profile setup is confirmed, it preserves the new community/live-now destinations. `/role-panel` then refreshes all three profile panels. A fresh guild can run the base setup first; profile setup alone does not create rules, XP or ticket infrastructure.

## Permissions explained before confirmation

The bot needs **Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, and Read Message History**. Keep its highest role above selectable roles. Administrator is unnecessary.

Only newly created profile/social categories and channels receive the reviewed overwrites: @everyone may View/Read; posting, reactions and thread posting/creation are denied. The bot receives View/Read/Send/Embed/Attach/Manage Channels/Manage Roles. Existing overwrites remain exactly as configured. Staff can manually adjust access later. Setup refuses management powers on @everyone. Public roles have zero server privileges and no channel permission grants.

**Optional alert ping permission:** Discord requires the opt-in role to be mentionable, or the sender to have **Mention @everyone, @here, and All Roles** (`MentionEveryone`) in the destination channel. Prefer granting this only to the bot in the reviewed social destination channels. The bot never grants it, changes overwrites or makes roles mentionable. Its payload still permits exactly one platform role, with everyone/here/user mentions disabled. Without suitable permission, delivery stops safely and retries.

## Member experience

| Panel | Choices | Behavior |
| --- | --- | --- |
| Community | 🎮 Gamer, 🔴 Live Notification, 🎬 Video Notification, 🤟 Sign Language, 🏆 Events | Tap to add; tap again to remove. |
| Notifications | 🎵 TikTok, ▶️ YouTube, 𝕏 X / Twitter, 📸 Instagram, 🟣 Twitch | Select **all platforms you want to keep** and submit. This replaces your platform choices. Clear the dropdown or use **Remove all notification roles** to opt out. |
| Country | 🇲🇦 Morocco, 🇩🇿 Algeria, 🇹🇳 Tunisia, 🇪🇬 Egypt, 🇫🇷 France, 🇪🇸 Spain, 🇬🇧 United Kingdom, 🇺🇸 United States, 🇨🇦 Canada, 🇩🇪 Germany, 🇧🇪 Belgium, 🇸🇦 Saudi Arabia, 🇦🇪 United Arab Emirates, 🌍 Other Country | One flag at a time. A new choice removes the previous country role. **Remove my country role** clears it. |

Replies are ephemeral. Complete Discord membership screening first; Verified is unnecessary for cosmetic roles. Shared dropdown defaults reveal no member choices. Country participation is optional, and flag roles are visible in Discord. The bot stores no member-to-country records, addresses or precise locations. Role updates preserve unrelated roles and attempt to restore the original group after a rejected partial change.

Only fixed approved choice keys are accepted, never submitted role IDs. Updates recheck bot permission, hierarchy, managed status, zero server privileges, channel grants and staff/bot names. Founder, Co-Founder, Moderator, Administrator, bot and verification roles cannot be obtained through these panels. Giving a profile role channel grants makes it ineligible.

Stable component IDs and saved canonical message IDs work across restarts without temporary collectors. Old/copied messages cannot assign roles. **Refresh Panels** edits saved messages and recovers deleted panel messages without restoring canonical resource names. It cannot recreate missing roles/channels; use a fresh Setup Panels preview. Run one bot process per data directory.

## Administrator dashboard

- **📁 Manage Channels / 🎭 Manage Roles:** enter a name in a modal. Enter an existing Discord resource ID to rename it, or leave the ID blank to create a text channel/nonprivileged role. Review then Confirm/Cancel. No deletion or permission editing. New roles have no permissions, are not mentionable and are not automatically added to public choices. Existing staff/bot/privileged roles are excluded. Enable Discord Developer Mode to copy IDs.
- **🔔 Notification Settings:** select a platform, set `true`/`false`, a public destination channel ID and a 1–1440 minute cooldown. Review and confirm. Opt-in role IDs come from setup and cannot be replaced with arbitrary staff roles in this interface.
- **🌍 Country Roles:** review enabling/disabling selection. Disabling preserves existing flags; members can still remove their flag.
- **⚙️ Setup Panels:** review missing resources and canonical channel rename/move; create/reuse and publish after confirmation.
- **🔄 Refresh Panels:** preview and confirm republishing existing messages with current settings and the configured logo.

Administrative replies are private. Authorization is checked against the current member again for modals and confirmations. Short button rows suit mobile screens. Role choice labels remain the approved labels even if staff rename the Discord role; Refresh preserves custom resource names, while Setup reviews canonical channel names again.

Use existing **`/auto-rule logo`** to upload your PNG/JPEG/WebP and confirm its rules preview. Profile panels reuse the locally saved asset as a thumbnail on refresh; no external image host is needed. The approved rules text stays unchanged.

## Social integrations

| Platform | Opt-in role | Support |
| --- | --- | --- |
| Twitch | 🟣 Twitch | Official Helix adapter; needs `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and a `/stream-config` account. |
| YouTube | ▶️ YouTube | Official Data API v3 adapter; needs `YOUTUBE_API_KEY` and a channel ID starting `UC`. First poll establishes a baseline. |
| TikTok | 🎵 TikTok | Saved roles/settings only; no automatic integration implemented. |
| Instagram | 📸 Instagram | Saved roles/settings only; no automatic integration implemented. |
| X / Twitter | 𝕏 X / Twitter | Saved roles/settings only; no automatic integration implemented. |

After confirmed profile setup, existing Twitch/YouTube accounts use the platform destination from Notification Settings (default live-now / ▶️・youtube). This routing change appears in the preview; explicit saved social settings are retained. Configure that destination first, then select the same channel in `/stream-config add`. Existing account records remain. Enabled settings do not supply credentials, API approval, a configured account or hosting.

The default minimum interval is five minutes per platform across accounts. Persistent receipts and existing nonce/history recovery prevent duplicate announcements, including lost responses/restarts. Cooldowns defer items without advancing past them; YouTube catches up oldest first within the latest 50 items. Disabled platforms are not polled. Pending alerts resume when enabled, within the provider's available window. Delivered items stay deduplicated after settings change. An unfinished send with changed role/channel settings requires staff review rather than risking a duplicate destination/ping.

General Live Notification/Video Notification roles are interest badges; platform alerts ping only the corresponding Twitch/YouTube opt-ins. No public command can publish arbitrary mass mentions. Future adapters must use the same delivery safeguards and supported platform access. No scraper, invented API access, paid dependency or external subscription is introduced.

## Discord acceptance checklist

- [ ] As an administrator, open `/manage-server`. Verify six controls, private preview, exact IDs and new-resource permissions. Cancel once: no Discord changes.
- [ ] Confirm Setup Panels in a test server. Existing rules, welcome, gaming, support, levels, staff, tickets and permission overwrites remain intact. Only reviewed resources change.
- [ ] Repeat setup and refresh: no extra roles, categories, channels or messages.
- [ ] Tap Gamer twice: added then removed, with private replies. Test all five buttons.
- [ ] Select Twitch + YouTube, then only TikTok: the previous two are removed. Clear all. No external subscription is created.
- [ ] Choose Morocco, then France: exactly one country flag. Remove it entirely. Unrelated roles remain and no public country announcement appears.
- [ ] Restart without deleting `data/`. Assigned Discord roles remain. The original buttons/dropdowns still add/remove roles.
- [ ] Ordinary members cannot use admin controls, forged/stale IDs or copied panels to assign arbitrary roles. In a test server, revoke bot Manage Roles or move a choice role above the bot: selection fails safely. Restore permissions afterward.
- [ ] Use modals to rename a harmless test channel and nonprivileged role. Cancel has no effect; Confirm changes only the reviewed name. Privileged role edits are rejected.
- [ ] Change a resource after preview: confirmation requires a fresh preview. Another administrator, expired previews and already-used previews cannot apply it.
- [ ] Confirm disabling country selection: existing flags remain, new choices stop, and clear still works. Enable again afterward.
- [ ] Save platform settings via preview/confirm. No credential values are entered/displayed. TikTok/Instagram/X clearly report settings-only support.
- [ ] After reviewing optional ping permission, grant it to the bot in a test alert channel. Securely configure your provider credentials and account. Verify only opted-in platform members are pinged, including when provider titles contain @everyone/@here/user mention strings.
- [ ] Repeat a provider item/restart: no duplicate notification. Two items within cooldown: second waits, then delivers once. Disable the platform: no polling/posting.
- [ ] Delete only a disposable test panel message and Refresh Panels: exactly one replacement appears and works.

Automated tests use real SQLite and Discord/provider fixtures, including reopened storage, partial-update recovery, canonical-message checks, cooldown checkpoints and exact role mentions. They do not authenticate to Discord/providers or prove live permissions. Codespaces must stay awake for interactions/polling; free continuous hosting is not guaranteed. Back up the complete ignored `data/` directory while stopped.
